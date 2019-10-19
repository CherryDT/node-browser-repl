const events = require('events');
const {EventEmitter} = events;
const stream = require('stream');
const path = require('path');
const fs = require('fs');
const url = require('url');
const http = require('http');
const repl = require('repl');
const { processTopLevelAwait } = require("node-repl-await");

function isRecoverableError(error) {
    if (error.name === 'SyntaxError') {
        return /^(Unexpected end of input|Unexpected token)/.test(error.message);
    }
    return false;
}

const _makeBufferCat = onmessage => {
  const bs = [];
  let bsBytes = 0;
  return chunk => {
    bs.push(chunk);
    bsBytes += chunk.byteLength;

    for (;;) {
      if (bsBytes >= Uint32Array.BYTES_PER_ELEMENT) {
        while (bs[0].byteLength < Uint32Array.BYTES_PER_ELEMENT) {
          const bsToConcat = [];
          let bsToConcatBytes = 0;
          while (bsToConcatBytes < Uint32Array.BYTES_PER_ELEMENT) {
            const b = bs.pop();
            bsToConcat.push(b);
            bsToConcatBytes += b.byteLength;
          }
          bs.unshift(Buffer.concat(bsToConcat));
        }
      
        const messageByteLength = new Uint32Array(bs[0].buffer, bs[0].byteOffset, 1)[0];

        if (bsBytes >= Uint32Array.BYTES_PER_ELEMENT + messageByteLength) {
          const b = bs.length === 1 ? bs[0] : Buffer.concat(bs);
          bs.length = 0;

          const bMessage = b.slice(Uint32Array.BYTES_PER_ELEMENT, Uint32Array.BYTES_PER_ELEMENT + messageByteLength);
          const bTail = b.slice(Uint32Array.BYTES_PER_ELEMENT + messageByteLength);

          onmessage(bMessage);

          bsBytes -= (Uint32Array.BYTES_PER_ELEMENT + messageByteLength);
          if (bTail.byteLength > 0) {
            bs.push(bTail);
          }
        } else {
          break;
        }
      } else {
        break;
      }
    }
  };
};

const {promisify} = require('util');
module.exports = (opts, cb = null) => (promisify((opts, cb) => {
  if (typeof opts === 'function') {
    cb = opts;
    opts = undefined;
  }
  opts = opts || {};
  const os = require('os');
  const {port = null, banner = () => `Connected to PID ${process.pid} [${process.title}] at ${os.hostname()} (Node ${process.version})`, evalFn = f => eval(f)} = opts;

  const _makeRepl = (socket, id) => {
    const bannerText = typeof banner === 'function' ? banner() : banner;
    if (bannerText) socket.send(Buffer.from(bannerText + '\n'));

    let live = true;

    const input = new stream.Readable();
    input._read = function() {};
    const output = new stream.Writable();
    output._write = function(chunk, encoding, next) {
      if (encoding !== 'buffer') {
        chunk = Buffer.from(chunk, encoding);
      }
      socket.send(chunk);

      next();
    };
    output.on('data', d => {
      console.log('output data', d);
    });
    const _makeInstance = () => repl.start({
      prompt: '> ',
      input,
      output,
      async eval(s, context, filename, cb) {
        const oldS = s;
        s = processTopLevelAwait(s) || s;
        const isAsync = s !== oldS;
        if (process.env.PRINT_REPL_COMMANDS) console.log('Executing from REPL:', s);
      
        try {
          let result = (await new Promise((resolve, reject) => {
            localEval(s, context, filename, (err, value) => {
              if (err) return reject(err);
              resolve(() => value); // Wrap in function to avoid automatic promise chaining
            });
          }))();
          if (isAsync) result = await result;
          cb(null, result);
        } catch (e) {
          if (isRecoverableError(e)) {
            cb(new repl.Recoverable(e));
          } else {
            cb(e);
          }
        }
        //localEval(s, context, filename, cb);
      },
      global: true,
      terminal: true,
      useColors: true,
    });
    const _bindInstance = r => {
      r.on('exit', () => {
        if (live) {
          r = _makeInstance();
          _bindInstance(r);
        }
      });
    };
    let r = _makeInstance();
    _bindInstance(r);

    socket.on('message', m => {
      const j = JSON.parse(m);
      const {method, args} = j;
      switch (method) {
        case 'c': {
          input.push(args, 'utf8');
          break;
        }
        case 'resize': {
          // console.log('resize', args); // XXX
          break;
        }
        default: {
          console.warn('unknown method', JSON.stringify(method));
        }
      }
    });
    socket.on('close', () => {
      live = false;
      r.close();
    });

    let localEval = (s, context, filename, cb) => {
      let err = null, result;
      try {
        result = evalFn(s);
      } catch (e) {
        err = e;
      }
      if (!err) {
        cb(null, result);
      } else {
        cb(err);
      }
    };
    
    return {
      id,
      socket,
      setEval(newEval) {
        localEval = newEval;
      },
      close() {
        socket.close();
      },
    };
  };
  const replServer = new EventEmitter();
  replServer.url = port ? `http://127.0.0.1:${port}/` : `file://${path.join(__dirname, 'index.html')}?protocol=message`;
  replServer.createConnection = u => {
    const {query} = url.parse(u, true);
    const {id} = query;

    const socket = new stream.Transform();
    const bcat = _makeBufferCat(b => {
      socket.emit('message', b.toString('utf8'));
    });
    socket._transform = (chunk, encoding, cb) => { // input from page
      bcat(chunk);
      cb();
    };
    socket.send = chunk => { // output to page
      socket.push(chunk);
    };

    const r = _makeRepl(socket, id);

    replServer.emit('repl', r);

    return socket;
  };

  if (port) {
    const ws = require('ws');

    const app = (req, res) => {
      if (req.method === 'GET') {
        const {p, type} = (() => {
          if (req.url === '/js/hterm_all.js') {
            return {
              p: path.join(__dirname, 'js', 'hterm_all.js'),
              type: 'application/javascript',
            };
          } else {
            return {
              p: path.join(__dirname, 'index.html'),
              type: 'text/html; charset=utf-8',
            };
          }
        })();
        res.setHeader('Content-Type', type);
        fs.createReadStream(p)
          .pipe(res);
      } else {
        res.end();
      }
    };
    const server = http.createServer(app);
    const wss = new ws.Server({
      noServer: true
    });
    server.on('upgrade', (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, ws => {
        const {query} = url.parse(request.url, true);
        const {id} = query;

        const r = _makeRepl(ws, id);
        replServer.emit('repl', r);
      });
    });
    server.on('error', cb);
    server.listen(port, '127.0.0.1', () => {
      cb(null, replServer);
    });
  } else {
    process.nextTick(() => {
      cb(null, replServer);
    });
  }
}))(opts).then(v => {
  if (cb) cb(null, v);
  return v;
}, e => {
  if (cb) cb(e, null);
  throw e;
});

if (require.main === module) {
  module.exports({ port: process.env.PORT || 9090 }).then(srv => console.log(`REPL listening on ${srv.url}`), e => { setImmediate(() => { throw e; }) });
}