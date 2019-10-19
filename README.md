# node-browser-repl

This package allows to access a node REPL terminal in the browser. It supports top-level `await` and may be used stand-alone or integrated into another application.

This is a fork of https://github.com/modulesio/hterm-repl/ by Avaer Kazmer <a@modules.io>

Changes by David Trapp <dt@david-trapp.com>

### Usage

Insert this code into some JavaScript that runs on startup, ideally in the root folder of the application (so that require paths are "natural" later on):

```javascript
const nodeBrowserRepl = require('node-browser-repl');

nodeBrowserRepl({
  port: 8000,
  evalFn: f => eval(f) // This will set the scope
});
```

You can then access `http://localhost:8000` to interact with your application. `await` is supported.

You can customize the welcome banner with a parameter `banner` in the options object which may be a string or a function evaluated upon a new connection.

`nodeBrowserRepl` returns a promise (or alternatively accepts a callback). The value will be a `replServer` event emitter object which emits a `repl` event when it is ready. The `repl` event receives a parameter `r` which has a method `close` to close the REPL session if required. Additionally, `r.socket.send(Buffer.from('Some text'))` may be called to push additional text to the browser.

For stand-alone usage, just run `npm start`. However, this may be of limited use because currently, global installation is not supported (it wouldn't respect the current path in require statements).

Important: **There is no authentication whatsoever**, and only HTTP (not HTTPS) listening on localhost is supported. If you want to use this as a debugging "backdoor" into a production system, I'd recommend using an SSH tunnel or a reverse proxy with authentication. (Be aware that this may still be susceptible to an attack if someone can cause another piece of software on the same system to send requests to localhost.)

There is also a local message-based method which I've not put much attention to. No guarantee whether it works.
