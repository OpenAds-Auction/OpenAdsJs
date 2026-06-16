# OpenAds.js

> A header bidding library built on Prebid.js for use within The Trade Desk's OpenAds platform.

This README is for developers who want to contribute to OpenAds.js.

**Table of Contents**

- [Usage](#Usage)
- [Install](#Install)
- [Build](#Build)
- [Run](#Run)
- [Contribute](#Contribute)

<a name="Usage"></a>

## Usage (as a npm dependency)

```javascript
import pbjs from 'openads.js';
import 'openads.js/modules/rubiconBidAdapter'; // imported modules will register themselves automatically
import 'openads.js/modules/appnexusBidAdapter';
pbjs.processQueue();  // required to process existing pbjs.queue blocks and setup any further pbjs.queue execution

pbjs.requestBids({
  ...
})
```

You can import just type definitions for every module from `types.d.ts`, and for the `pbjs` global from `global.d.ts`:

```typescript
import 'openads.js/types.d.ts';
import 'openads.js/global.d.ts';
pbjs.que.push(/* ... */)
```

Or, if your bundle uses a different global variable name:

```typescript
import type {PrebidJS} from 'openads.js/types.d.ts';
declare global {
    interface Window {
        myCustomGlobal: PrebidJS;
    }
}
```

<a id="customize-options"></a>

### Customize build options

If you're using Webpack, you can use the `openads.js/customize/webpackLoader` loader to set the following options:

| Name | Type | Description | Default |
| ---- | ---- | ----------- | ------- |
| globalVarName | String | Global variable name | `"pbjs"` |
| defineGlobal | Boolean | If false, do not set a global variable | `true` |
| distUrlBase | String | Base URL to use for dynamically loaded modules | `"https://cdn.jsdelivr.net/npm/prebid.js/dist/chunks/"` |

For example, to set a custom global variable name:

```javascript
// webpack.conf.js
module.exports = {
  module: {
    rules: [
      {
        loader: 'openads.js/customize/webpackLoader',
        options: {
          globalVarName: 'myCustomGlobal'
        }
      },
    ]
  }
}
```


<a name="Install"></a>

## Install

    $ git clone <repository-url>
    $ cd OpenAdsJs
    $ npm ci

*Note:* You need to have `NodeJS` 12.16.1 or greater installed.

*Note:* This project uses gulp 4.0. You'll need to have `gulp-cli` installed globally prior to running `npm ci`.

If you have a previous version of `gulp` installed globally, remove it first: `npm rm gulp -g`

Then install gulp-cli globally: `npm install gulp-cli -g`


<a name="Build"></a>

## Build for Development

To build the project on your local machine we recommend running:

    $ gulp serve-and-test --file <spec_file.js>

This will run testing but not linting. A web server will start at `http://localhost:9999` serving from the project root and generates the following files:

+ `./build/dev/openads.js` - Full source code for dev and debug
+ `./build/dev/openads.js.map` - Source map for dev and debug
+ `./build/dev/openads-core.js`
+ `./build/dev/openads-core.js.map`

Development may be a bit slower but if you prefer linting and additional watch files you can also run:

    $ gulp serve


### Build Optimization

The standard build output contains all the available modules from within the `modules` folder.

You can specify the modules to be included with the `--modules` CLI argument.

For example: `gulp serve --modules=openxBidAdapter,rubiconBidAdapter,sovrnBidAdapter`

**Build standalone openads.js**

- Clone the repo, run `npm ci`
- Then run the build:

        $ gulp build --modules=openxBidAdapter,rubiconBidAdapter,sovrnBidAdapter

Alternatively, a `.json` file can be specified that contains a list of modules:

    $ gulp build --modules=modules.json

With `modules.json` containing the following:
```json
[
  "openxBidAdapter",
  "rubiconBidAdapter",
  "sovrnBidAdapter"
]
```

**Build once, bundle multiple times**

If you need to generate multiple distinct bundles from the same version, you can reuse a single build with:

```
gulp build
gulp bundle --tag one --modules=one.json
gulp bundle --tag two --modules=two.json
```

<a name="Run"></a>

### Excluding particular features from the build

You may instruct the build to exclude code for some features:

```
gulp build --disable NATIVE --modules=openxBidAdapter,rubiconBidAdapter,sovrnBidAdapter
```

Features that can be disabled this way are:

 - `VIDEO` - support for video bids
 - `NATIVE` - support for native bids
 - `UID2_CSTG` - support for UID2 client side token generation
 - `GREEDY` - disables the use of blocking, "greedy" promises
 - `LOG_NON_ERROR` - support for non-error console messages
 - `LOG_ERROR` - support for error console messages

## Unminified code

You can get a version of the code that's unminified for debugging with `build-bundle-dev`:

```bash
gulp build-bundle-dev --modules=bidderA,module1,...
```

The results will be in `build/dev/openads.js`.

## ES5 Output Support

For compatibility with older parsers or environments that require ES5 syntax, use the `--ES5` flag:

```bash
gulp build-bundle-dev --modules=bidderA,module1,... --ES5
```

## Test locally

To lint the code:

```bash
gulp lint
```

To run the unit tests:

```bash
gulp test
```

To run the unit tests for a particular file:
```bash
gulp test --file "test/spec/modules/pubmaticBidAdapter_spec.js" --nolint
```

To generate and view the code coverage reports:

```bash
gulp test-coverage
gulp view-coverage
```

For development:

```javascript
(function() {
    var d = document, pbs = d.createElement('script'), pro = d.location.protocol;
    pbs.type = 'text/javascript';
    pbs.src = ((pro === 'https:') ? 'https' : 'http') + './build/dev/openads.js';
    var target = document.getElementsByTagName('head')[0];
    target.insertBefore(pbs, target.firstChild);
})();
```

For deployment:

```javascript
(function() {
    var d = document, pbs = d.createElement('script'), pro = d.location.protocol;
    pbs.type = 'text/javascript';
    pbs.src = ((pro === 'https:') ? 'https' : 'http') + './build/dist/openads.js';
    var target = document.getElementsByTagName('head')[0];
    target.insertBefore(pbs, target.firstChild);
})();
```

Build and run the project locally with:

```bash
gulp serve
```

This runs `lint` and `test`, then starts a web server at `http://localhost:9999` serving from the project root.
Navigate to your example implementation to test, and if your `openads.js` file is sourced from the `./build/dev`
directory you will have sourcemaps available in your browser's developer tools.

To run the example file, go to:

+ `http://localhost:9999/integrationExamples/gpt/hello_world.html`

As you make code changes, the bundles will be rebuilt and the page reloaded automatically.

<a name="Contribute"></a>

## Contribute

For guidelines, see [Contributing](./CONTRIBUTING.md).

### Code Quality

Code quality is defined by `.eslintrc` and errors are reported in the terminal.

If you are contributing code, you should [configure your editor](http://eslint.org/docs/user-guide/integrations#editors) with the provided `.eslintrc` settings.

### Unit Testing with Karma

        $ gulp test --watch --browsers=chrome

This will run tests and keep the Karma test browser open. If your `openads.js` file is sourced from the `./build/dev` directory you will also have sourcemaps available when using your browser's developer tools.

+ To access the Karma debug page, go to `http://localhost:9876/debug.html`

+ For test results, see the console

+ To set breakpoints in source code, see the developer tools

Detailed code coverage reporting can be generated explicitly with

        $ gulp test --coverage

The results will be in

        ./build/coverage
