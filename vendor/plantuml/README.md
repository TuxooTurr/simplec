# PlantUML renderer distributed with Shark

The worker runs the upstream headless PlantUML engine with Viz.js on the Node.js runtime already used by Shark. Both modules are bundled so that rendering and installation of an updated Shark checkout need no extra downloads.

| File | Upstream distribution | SHA-256 |
| --- | --- | --- |
| `engine.mjs` | `engine.js` from [@plantuml/mcp-js 0.2.4](https://registry.npmjs.org/@plantuml/mcp-js/-/mcp-js-0.2.4.tgz) | `b465cf167db9822e9a6032ec16d4a0f2e8a1cb10f62b4e54b7073aaa94cfb485` |
| `viz.mjs` | `dist/viz.js` from [@viz-js/viz 3.31.0](https://registry.npmjs.org/@viz-js/viz/-/viz-js-viz-3.31.0.tgz) | `b9840ae5b70681356c207510db8820ac3f883607740616455d9c7c47d67ea646` |

The bundled upstream modules are unmodified. See the [PlantUML source](https://github.com/plantuml/plantuml/tree/master/plantuml-mcp-js) and [Viz.js build source](https://github.com/mdaines/viz-js/tree/c8ce050). The Viz.js module contains [Graphviz 16.1.0](https://gitlab.com/api/v4/projects/4207231/packages/generic/graphviz-releases/16.1.0/graphviz-16.1.0.tar.gz) and [Expat 2.8.5](https://github.com/libexpat/libexpat/releases/tag/R_2_8_5). License texts for all four components are in this directory.
