import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { startPrivateLibraryServer } from "../paper-library/local-server.mjs"

const FIXED_PORT = 4176
const FAILURE_MESSAGE = "本地论文库服务启动失败。请检查本机配置和构建边界。\n"

export function parseServeArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new TypeError("本地论文库服务参数无效")
  }
  return { port: FIXED_PORT }
}

export async function main({
  argv = process.argv.slice(2),
  repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url))),
  start = startPrivateLibraryServer,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const { port } = parseServeArguments(argv)
    const server = await start({ repoRoot, port })
    stdout.write(`本地论文库服务：${server.origin}/local_library_output/desktop/library.html\n`)
    return 0
  } catch {
    stderr.write(FAILURE_MESSAGE)
    return 1
  }
}

const invokedPath = typeof process.argv[1] === "string"
  ? pathToFileURL(resolve(process.argv[1])).href
  : null

if (invokedPath === import.meta.url) {
  process.exitCode = await main()
}
