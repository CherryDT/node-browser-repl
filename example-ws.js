const htermRepl = require('.');

htermRepl({
  port: 8000,
  evalFn: f => eval(f)
});
