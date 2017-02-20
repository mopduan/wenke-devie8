var webpack = require("webpack");
var async = require('async');
var gulp = require('gulp');
var fs = require('fs');
var path = require('path');
var utils = require('./lib/utils');
global.srcPrefix = '/src/';
global.deployPrefix = '/deploy/';
global.debugDomain = /\$!{0,1}\{.+?\}/ig;

exports = module.exports = function (options) {
    var webappDirectory = options.webappDirectory;
    var webappDirectoryList = [];
    if (webappDirectory && typeof webappDirectory == 'string') {
        webappDirectoryList = webappDirectory.split(',');
        webappDirectoryList.forEach(function (item, index) {
            item = item.trim();
            if (!fs.existsSync(item)) {
                throw new Error('can\'t find the webapp directory: ' + item);
            }
        });
    } else {
        throw new Error('can\'t find the arugment -w, this argument is webapp directory!');
    }

    var staticFilesDirectory = options.staticFilesDirectory;

    if (staticFilesDirectory && typeof staticFilesDirectory == 'string') {
        if (!fs.existsSync(staticFilesDirectory)) {
            throw new Error('can\'t find the static files directory ', staticFilesDirectory);
        }
    } else {
        throw new Error('can\'t find the arugment -s, this argument is webapp static file directory!');
    }

    global.staticDirectory = utils.normalizePath(staticFilesDirectory);

    if (!fs.existsSync(path.join(global.staticDirectory, 'src'))) {
        throw new Error("can't find 'src' directory in staticDirectory ");
    }

    var templateFileList = [];
    webappDirectoryList.forEach(function (item, index) {
        var templateViewSrcPagePath = path.join(item, '/src/main/webapp/WEB-INF/view/src/');
        //if no webapp directory, then exit;
        if (!fs.existsSync(templateViewSrcPagePath)) {
            throw new Error('can\'t find the webapp velocity template directory: ' + templateViewSrcPagePath);
        }
        utils.getAllFilesByDir(templateViewSrcPagePath, templateFileList, ['.vm', '.html', '.tpl']);
    });

    var cssCacheList = {};
    var cssCompileList = [];
    var regexpStaticFilesPrefix = utils.getRegexpStaticFilesPrefix();

    templateFileList.forEach(function (tplPath) {
        var tplContent = fs.readFileSync(tplPath).toString();

        tplContent.replace(utils.getRegexpCSSLinkElements(), function ($link) {
            $link.replace(utils.getRegexpCSSHrefValue(), function ($cssLink, $someSplitStr, $href) {
                var cssPath = $href.replace(regexpStaticFilesPrefix, '');
                if (!cssCacheList[cssPath]) {
                    if ($href && !($href.indexOf('http') == 0)) {
                        cssCompileList.push(path.join(global.staticDirectory, cssPath));
                        cssCacheList[cssPath] = true;
                    }
                }

                return $cssLink;
            });

            return $link;
        });
    });

    var jsCacheList = {};
    var jsCompileList = [];

    templateFileList.forEach(function (tplPath, index) {
        var tplContent = fs.readFileSync(tplPath).toString();
        tplContent.replace(utils.getRegexpScriptElements(), function ($1, $2) {
            if ($2.indexOf('type="text/html"') > -1) {
                return $1;
            }

            if ($2.toLowerCase().indexOf('release="false"') > -1) {
                return $1;
            }

            $1.replace(utils.getRegexpScriptElementSrcAttrValue(), function ($2_1, $src) {
                if ($src && $src.toLowerCase().indexOf('http') == -1) {
                    var jsPath = $src.replace(regexpStaticFilesPrefix, '');
                    if (!jsCacheList[jsPath]) {
                        if ($src.indexOf('bundle.js') != -1) {
                            //需要使用ES6/7/8转换的JS
                            var isES = $2.toLowerCase().indexOf('babel="true"') > -1;
                            var jsSrcPath = utils.normalizePath(path.join(global.staticDirectory, path.dirname(jsPath), 'main.js')).replace(global.deployPrefix, global.srcPrefix)

                            jsCompileList.push({
                                "babel": isES,
                                "path": jsSrcPath
                            });

                            jsCacheList[jsPath] = true;
                        }
                    }
                }
            });
        });
    });

    jsCompileList = utils.jsonArrayUnique(jsCompileList);

    console.log('jsCompileList：');
    console.log(jsCompileList);

    var babelSettings = {
        cacheDirectory: true,
        presets: [[__dirname + "/node_modules/babel-preset-es2015", {
            "loose": true
        }], __dirname + "/node_modules/babel-preset-es2016", __dirname + "/node_modules/babel-preset-es2017", __dirname + '/node_modules/babel-preset-react'],
        compact: false
    };

    var commonConfig = {
        cache: true,
        resolve: {extensions: ['', '.js', '.jsx'], fallback: path.join(__dirname, "node_modules")},
        resolveLoader: {fallback: path.join(__dirname, "node_modules")},
        devtool: utils.hasArgument(process.argv, '--inline') ? "inline-source-map" : "eval",
        babel: {
            presets: [[__dirname + "/node_modules/babel-preset-es2015", {
                "loose": true
            }], __dirname + "/node_modules/babel-preset-es2016", __dirname + "/node_modules/babel-preset-es2017", __dirname + '/node_modules/babel-preset-react']
        }
    };

    async.map(jsCompileList, function (jsCompileItem, callback) {
        var rebuildCompile = false;
        var contextPath = path.join(global.staticDirectory, global.srcPrefix, 'js');
        var staticFilesSourceDir = path.join(global.staticDirectory, global.srcPrefix);
        var entryPath = './' + jsCompileItem.path.replace(utils.normalizePath(contextPath), '');
        var config = {
            context: contextPath,
            entry: entryPath,
            plugins: [],
            output: {
                path: path.join(global.staticDirectory, global.deployPrefix, 'js', utils.normalizePath(path.dirname(jsCompileItem.path)).replace(utils.normalizePath(contextPath), '')),
                filename: "bundle.js",
                chunkFilename: "[id].bundle.js",
                publicPath: utils.normalizePath(path.join("/sf/", utils.normalizePath(path.join(global.deployPrefix, 'js', utils.normalizePath(path.dirname(jsCompileItem.path)).replace(utils.normalizePath(contextPath), ''))), '/'))
            }
        };

        config.externals = {
            "react": "React",
            "react-dom": "ReactDOM",
            "redux": "Redux",
            "react-redux": "ReactRedux",
            "react-router": "ReactRouter",
            "immutable": "Immutable",
            "vue": "Vue",
            "vue-router": "VueRouter",
            "vuex": "Vuex"
        };

        config.module = {loaders: utils.getLoaders()};
        utils.extendConfig(config, commonConfig);

        if (jsCompileItem.babel) {
            config.module.loaders.push({
                test: /\.(js|jsx)$/,
                loader: 'babel-loader',
                exclude: /(node_modules|bower_components)/,
                include: [staticFilesSourceDir],
                query: babelSettings
            });
        }

        var compiler = webpack(config);
        compiler.watch({
            aggregateTimeout: 300,
            poll: true
        }, function (err, stats) {
            if (err) {
                throw err;
            }

            if (stats.hasErrors()) {
                console.log('ERROR start ==============================================================');
                console.log(stats.toString());
                console.log('ERROR end   ==============================================================');
            } else {
                console.log(stats.toString());
            }

            if (rebuildCompile) {
                console.log('rebuild complete!');
            }

            if (typeof callback == 'function') {
                callback();
            }

            if (!rebuildCompile) {
                rebuildCompile = true;
                callback = null;
            }
        });
    }, function (err) {
        if (err) {
            throw err;
        }

        gulp.task('default', function () {
            var watchFiles = [];

            webappDirectoryList.forEach(function (item, index) {
                var webappViewSrcDir = item + '/src/main/webapp/WEB-INF/view/src/';
                watchFiles.push(path.join(webappViewSrcDir + "/**/*.vm"));
                watchFiles.push(path.join(webappViewSrcDir + "/**/*.html"));
                watchFiles.push(path.join(webappViewSrcDir + "/**/*.tpl"));
            });
            watchFiles.push(cssCompileList);
            console.log('watchFiles List: ');
            console.log(watchFiles);
            console.log('build complete!');

            gulp.watch(watchFiles).on('change', function () {
                console.log("files changed： please refresh browser...");
            });
        });

        gulp.start();
    });
};