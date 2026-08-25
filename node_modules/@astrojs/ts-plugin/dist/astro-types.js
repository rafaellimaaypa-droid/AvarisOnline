"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAstroPackageDirectory = findAstroPackageDirectory;
exports.isAstroProject = isAstroProject;
exports.addAstroTypes = addAstroTypes;
const node_path_1 = __importDefault(require("node:path"));
const decoratedHosts = new WeakSet();
/**
 * Walk up from the given directories until an installed `astro` package is found,
 * returning the directory that contains its `package.json`.
 */
function findAstroPackageDirectory(tsModule, currentDirectory) {
    for (const candidate of Array.isArray(currentDirectory) ? currentDirectory : [currentDirectory]) {
        const astroDirectory = findAstroPackageDirectoryFrom(tsModule, candidate);
        if (astroDirectory) {
            return astroDirectory;
        }
    }
}
function findAstroPackageDirectoryFrom(tsModule, currentDirectory) {
    let directory = tsModule.sys.resolvePath(currentDirectory);
    while (true) {
        const packageJson = node_path_1.default.join(directory, 'node_modules', 'astro', 'package.json');
        if (tsModule.sys.fileExists(packageJson)) {
            return node_path_1.default.dirname(packageJson);
        }
        const parent = node_path_1.default.dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}
/**
 * Check whether a directory belongs to an Astro project, by looking for an `astro`
 * dependency in the nearest `package.json` and falling back to an `astro.config.*` file
 * next to it. Mirrors the language server's `getAstroInstall()` check.
 */
function isAstroProject(tsModule, currentDirectory) {
    const packageJson = findNearestPackageJson(tsModule, currentDirectory);
    if (!packageJson) {
        return true;
    }
    try {
        const content = JSON.parse(tsModule.sys.readFile(packageJson) ?? '{}');
        const deps = [
            ...Object.keys(content.dependencies ?? {}),
            ...Object.keys(content.devDependencies ?? {}),
            ...Object.keys(content.peerDependencies ?? {}),
        ];
        if (deps.includes('astro')) {
            return true;
        }
    }
    catch { }
    return tsModule.sys
        .readDirectory(node_path_1.default.dirname(packageJson), ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'], undefined, undefined, 1)
        .some((file) => node_path_1.default.basename(file).startsWith('astro.config'));
}
function findNearestPackageJson(tsModule, currentDirectory) {
    let directory = tsModule.sys.resolvePath(currentDirectory);
    while (true) {
        const packageJson = node_path_1.default.join(directory, 'package.json');
        if (tsModule.sys.fileExists(packageJson)) {
            return packageJson;
        }
        const parent = node_path_1.default.dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}
/**
 * Inject the installed Astro package's `env.d.ts` and `astro-jsx.d.ts` into the
 * TypeScript program. Without these, the `Astro` global is undeclared and the type
 * chain through `Astro.locals` can't be resolved, so "Go To References" from a `.ts`
 * file misses usages inside `.astro` files. Mirrors the language server's
 * `addAstroTypes()`.
 */
function addAstroTypes(tsModule, host, currentDirectory) {
    if (decoratedHosts.has(host)) {
        return;
    }
    const astroDirectory = findAstroPackageDirectory(tsModule, currentDirectory);
    if (!astroDirectory) {
        return;
    }
    const addedFileNames = ['./env.d.ts', './astro-jsx.d.ts']
        .map((filePath) => tsModule.sys.resolvePath(node_path_1.default.resolve(astroDirectory, filePath)))
        .filter((fileName) => tsModule.sys.fileExists(fileName));
    if (!addedFileNames.length) {
        return;
    }
    decoratedHosts.add(host);
    const getScriptFileNames = host.getScriptFileNames.bind(host);
    host.getScriptFileNames = () => {
        const fileNames = getScriptFileNames();
        const seen = new Set(fileNames);
        return [...fileNames, ...addedFileNames.filter((fileName) => !seen.has(fileName))];
    };
}
