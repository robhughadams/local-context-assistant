import fs from "node:fs/promises";
import path from "node:path";

import { ACTION_LOG_FILE_NAME, dataFilePath } from "../config";
import { ensureDir } from "../fs-utils";
import type { ToolActionLogEntry } from "../types";

export class ToolActionLogger {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  async append(entry: ToolActionLogEntry): Promise<void> {
    const logPath = dataFilePath(this.workspaceRoot, ACTION_LOG_FILE_NAME);
    await ensureDir(path.dirname(logPath));
    await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  }
}
