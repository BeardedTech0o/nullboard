#!/usr/bin/env node
// Bundles index.html + style.css + app.js into one self-contained HTML file
// for people who just want to keep a single file on their desktop.
'use strict';

var fs = require('fs');
var path = require('path');

var dir = __dirname;
var html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
var js = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');

html = html.replace(
  '<link rel="stylesheet" href="style.css">',
  '<style>\n' + css + '\n</style>'
);
html = html.replace(
  '<script src="app.js"></script>',
  '<script>\n' + js + '\n</script>'
);

var outPath = path.join(dir, 'nullboard.single.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
