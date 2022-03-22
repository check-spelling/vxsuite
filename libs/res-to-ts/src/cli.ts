import { err, ok, Result } from '@votingworks/types';
import assert from 'assert';
import { promises as fs } from 'fs';
import globby from 'globby';
import { basename, isAbsolute, join, relative } from 'path';
import { convert, Resource } from './convert';
import { getMimeType } from './mime';

/**
 * Represents IO for a CLI. Facilitates mocking for testing.
 */
export interface Stdio {
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
  readonly stderr: NodeJS.WritableStream;
}

/**
 * The default IO implementation.
 */
export const RealIo: Stdio = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
};

/**
 * All possible options for the CLI.
 */
export type Options = HelpOptions | ConvertOptions;

/**
 * Options for the CLI when run with `--help`.
 */
export interface HelpOptions {
  readonly type: 'help';
  readonly help: true;
}

/**
 * Options for the CLI's default mode.
 */
export interface ConvertOptions {
  readonly type: 'convert';
  readonly help: false;
  readonly check: boolean;
  readonly rootDir?: string;
  readonly outDir?: string;
  readonly resources: readonly Resource[];
}

/**
 * Prints command usage to {@link out}.
 */
function usage(programName: string, out: NodeJS.WritableStream): void {
  out.write(`usage: ${programName} [--help] [--check] FILE [… FILE]\n`);
  out.write(`\n`);
  out.write(`Converts resources to be usable as TypeScript files.\n`);
}

/**
 * @visibleForTesting
 */
export function absolutize(path: string, base: string): string {
  return isAbsolute(path) ? path : join(base, path);
}

/**
 * @visibleForTesting
 */
export function relativize(path: string, base?: string): string {
  return base ? relative(base, path) : path;
}

/**
 * Determines the output `.ts` path for a resource.
 */
export function getOutputPath(
  resourcePath: string,
  rootDir?: string,
  outDir?: string
): string {
  if (!outDir) {
    return `${resourcePath}.ts`;
  }

  assert(typeof rootDir === 'string');

  const relativePath = relative(rootDir, resourcePath);
  return `${join(outDir, relativePath)}.ts`;
}

/**
 * Parses and validates command-line arguments.
 */
async function parseOptions(
  args: readonly string[]
): Promise<Result<Options, Error>> {
  let help = false;
  let check = false;
  let rootDir: string | undefined;
  let outDir: string | undefined;
  const globs: string[] = [];
  const resources: Resource[] = [];

  for (let i = 2; i < args.length; i += 1) {
    const arg = args[i] as string;
    switch (arg) {
      case '-h':
      case '--help':
        help = true;
        break;

      case '--check':
        check = true;
        break;

      case '-o':
      case '--outDir': {
        outDir = args[i + 1];
        if (!outDir || outDir.startsWith('-')) {
          return err(new Error(`missing output directory after '${arg}'`));
        }
        outDir = absolutize(outDir, process.cwd());
        i += 1;
        break;
      }

      case '--rootDir': {
        rootDir = args[i + 1];
        if (!rootDir || rootDir.startsWith('-')) {
          return err(new Error(`missing root directory after '${arg}'`));
        }
        rootDir = absolutize(rootDir, process.cwd());
        i += 1;
        break;
      }

      default: {
        const glob = arg;
        if (glob.startsWith('-')) {
          return err(new Error(`unrecognized option: ${glob}`));
        }
        globs.push(glob);
        break;
      }
    }
  }

  if (help) {
    return ok({ type: 'help', help });
  }

  if (outDir && !rootDir) {
    rootDir = process.cwd();
  }

  for (const glob of globs) {
    for (const path of await globby(glob, { absolute: true })) {
      if (rootDir && !path.startsWith(`${rootDir}/`)) {
        return err(
          new Error(
            `resource '${path}' is not in the root directory '${rootDir}'`
          )
        );
      }

      resources.push({
        path,
        tsPath: getOutputPath(path, rootDir, outDir),
        mimeType: getMimeType(path),
      });
    }
  }

  if (resources.length === 0) {
    return err(new Error('no resources given'));
  }

  return ok({ type: 'convert', help, check, rootDir, outDir, resources });
}

/**
 * Main entry point for `res-to-ts` command.
 */
export async function main(
  args: readonly string[],
  io: Stdio
): Promise<number> {
  const programName = basename(args[1] as string);
  const parseOptionsResult = await parseOptions(args);

  if (parseOptionsResult.isErr()) {
    io.stderr.write(`error: ${parseOptionsResult.err().message}\n`);
    usage(programName, io.stderr);
    return 1;
  }

  const options = parseOptionsResult.ok();

  if (options.help) {
    usage(programName, io.stdout);
    return 0;
  }

  const { check, resources } = options;
  let exitCode = 0;

  for (const resource of resources) {
    const output = await convert(resource);
    const displayPath = relativize(resource.tsPath, process.cwd());

    if (check) {
      let success = true;
      try {
        const existingContent = await fs.readFile(resource.tsPath, 'utf8');
        success = existingContent === output;
      } catch {
        success = false;
      }

      if (!success) {
        io.stderr.write(`❌ ${displayPath} is out of date\n`);
        exitCode = 1;
      } else {
        io.stdout.write(`✅ ${displayPath}\n`);
      }
    } else {
      await fs.writeFile(resource.tsPath, output);
      io.stdout.write(`📝 ${displayPath}\n`);
    }
  }

  return exitCode;
}
