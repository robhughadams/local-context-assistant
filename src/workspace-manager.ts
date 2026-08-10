import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

import {
  DEFAULT_EXCLUDE_DIRS,
  DEFAULT_EXCLUDE_FILES,
  DEFAULT_INCLUDE_EXTENSIONS,
  DATA_DIR_NAME
} from "./config";
import type { FileCandidate } from "./types";

export interface WatchHandle {
  close: () => void;
}

export class WorkspaceManager {
  discoverProjectRoot(startDir: string = process.cwd()): string {
    return path.resolve(startDir);
  }

  async listIndexableFiles(workspaceRoot: string): Promise<FileCandidate[]> {
    const output: FileCandidate[] = [];
    await this.walk(workspaceRoot, workspaceRoot, output);
    return output.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  watchWorkspace(workspaceRoot: string, onChange: (relativePath: string) => void): WatchHandle {
    const watcher = watch(
      workspaceRoot,
      { recursive: false },
      (_eventType, maybePath) => {
        if (!maybePath) {
          return;
        }
        const normalized = maybePath.split(path.sep).join("/");
        if (this.shouldIgnoreRelativePath(normalized)) {
          return;
        }
        onChange(normalized);
      }
    );

    // TODO: replace with a robust recursive watcher with debounce and batched re-index queue.
    return {
      close: () => watcher.close()
    };
  }

  private async walk(currentDir: string, workspaceRoot: string, output: FileCandidate[]): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) {
          continue;
        }
        await this.walk(absolutePath, workspaceRoot, output);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (DEFAULT_EXCLUDE_FILES.has(entry.name)) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!DEFAULT_INCLUDE_EXTENSIONS.has(extension)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      output.push({
        relativePath,
        absolutePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size
      });
    }
  }

  private shouldIgnoreRelativePath(relativePath: string): boolean {
    const parts = relativePath.split("/");
    if (parts.some((part) => DEFAULT_EXCLUDE_DIRS.has(part))) {
      return true;
    }
    const fileName = parts[parts.length - 1] ?? "";
    if (DEFAULT_EXCLUDE_FILES.has(fileName)) {
      return true;
    }
    if (relativePath.startsWith(`${DATA_DIR_NAME}/`)) {
      return true;
    }
    return false;
  }
}
