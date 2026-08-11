#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const homeDir = os.homedir();
const projectRoot = path.resolve(__dirname, "..");
const cliPath = path.join(projectRoot, "dist", "cli.js");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

function ensureBuildArtifact() {
  if (!fs.existsSync(path.join(projectRoot, "node_modules"))) {
    run("npm", ["install"]);
  }

  if (!fs.existsSync(cliPath)) {
    run("npm", ["run", "build"]);
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (raw.length === 0) {
    return fallback;
  }

  return JSON.parse(raw);
}

function writeJson(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = `${JSON.stringify(content, null, 2)}\n`;
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (current !== next) {
    fs.writeFileSync(filePath, next, "utf8");
  }
}

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
}

function installOpencode() {
  const configPath = path.join(homeDir, ".config", "opencode", "opencode.json");
  const config = ensureObject(readJson(configPath, {}));
  const commands = ensureObject(config.commands);

  commands.lca = {
    description: "Local Context Assistant CLI",
    command: "node",
    args: [cliPath],
    cwd: projectRoot
  };

  config.commands = commands;
  writeJson(configPath, config);

  return configPath;
}

function installClaude() {
  const configPath = path.join(homeDir, ".claude", "settings.local.json");
  const config = ensureObject(readJson(configPath, {}));
  const commands = ensureObject(config.commands);

  commands.lca = {
    description: "Local Context Assistant CLI",
    command: "node",
    args: [cliPath],
    cwd: projectRoot
  };

  config.commands = commands;
  writeJson(configPath, config);

  return configPath;
}

function installKiro() {
  const configPath = path.join(homeDir, ".kiro", "settings", "cli.json");
  const config = ensureObject(readJson(configPath, {}));
  const commands = ensureObject(config.commands);

  commands.lca = {
    description: "Local Context Assistant CLI",
    command: "node",
    args: [cliPath],
    cwd: projectRoot
  };

  config.commands = commands;
  writeJson(configPath, config);

  return configPath;
}

function main() {
  ensureBuildArtifact();

  const installedPaths = {
    opencode: installOpencode(),
    claude: installClaude(),
    "kiro-cli": installKiro()
  };

  console.log("Installed Local Context Assistant command registrations:");
  for (const [harness, installPath] of Object.entries(installedPaths)) {
    console.log(`- ${harness}: ${installPath}`);
  }
}

main();
