"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_path_1 = __importDefault(require("node:path"));
const createLanguageServicePlugin_js_1 = require("@volar/typescript/lib/quickstart/createLanguageServicePlugin.js");
const astro_types_js_1 = require("./astro-types.js");
const frontmatter_js_1 = require("./frontmatter.js");
const language_js_1 = require("./language.js");
module.exports = (0, createLanguageServicePlugin_js_1.createLanguageServicePlugin)((ts, info) => {
    let collectionConfig = undefined;
    const currentDir = info.project.getCurrentDirectory();
    // Make "Go To References" from `.ts` files aware of usages inside `.astro` files
    // by injecting the Astro ambient types so type chains like `Astro.locals.*` resolve.
    // (`.astro` files themselves already enter the program via Volar's external files.)
    if ((0, astro_types_js_1.isAstroProject)(ts, currentDir)) {
        (0, astro_types_js_1.addAstroTypes)(ts, info.languageServiceHost, [
            currentDir,
            ...info.languageServiceHost.getScriptFileNames().map((fileName) => node_path_1.default.dirname(fileName)),
        ]);
    }
    try {
        const fileContent = ts.sys.readFile(currentDir + '/.astro/collections/collections.json');
        if (fileContent) {
            collectionConfig = {
                folder: currentDir,
                config: JSON.parse(fileContent),
            };
        }
    }
    catch (err) {
        // If the file doesn't exist, we don't really care, but if it's something else, we want to know
        if (err && err.code !== 'ENOENT')
            console.error(err);
    }
    let languagePlugins = [(0, language_js_1.getLanguagePlugin)()];
    if (collectionConfig) {
        languagePlugins.push((0, frontmatter_js_1.getFrontmatterLanguagePlugin)([collectionConfig]));
    }
    return {
        languagePlugins,
    };
});
