/**
 * Add the capability to load CMD modules in node environment
 * @author lifesinger@gmail.com
 */

var fs = require("fs")
var path = require("path")
var vm = require("vm")// TAG 虚拟机，用于隔离上下文，被调用的代码将上下文中的任何属性都视为全局变量
var normalize = require("./winos").normalize

var moduleStack = []
var uriCache = {}
var nativeLoad

runSeaJS("../dist/sea-debug.js")
hackNative()
attach()
keep()
seajs.config({ cwd: normalize(process.cwd()) + "/" })


function runSeaJS(filepath) {
  var code = fs.readFileSync(path.join(__dirname, filepath), "utf8")// TAG 同步读取文件
  code = code.replace("})(this);", "})(exports);")

  // Run "sea.js" code in a fake browser environment
  var sandbox = require("./sandbox") // TAG 假沙箱？用于模拟浏览器环境
  vm.runInNewContext(code, sandbox, "sea-debug.vm") // TAG args: 代码，上下文隔离的对象，堆栈跟踪信息所使用的文件名

  global.seajs = sandbox.exports.seajs
  global.define = sandbox.exports.define // ? define从哪里来 ： sea-debug.js执行后获得
}

function hackNative() {
  var Module = module.constructor // ? module哪里来 ： sea-debug.js执行后获得
  nativeLoad = Module._load

  // TAG 扩展Module._load
  Module._load = function(request, parent, isMain) {
    var exports = nativeLoad(request, parent, isMain)

    var _filename = Module._resolveFilename(request, parent)
    var filename = normalize(_filename)

    var mod = seajs.cache[filename] // TAG 从缓存中获取文件数据
    if (mod) {
      if (mod.status < seajs.Module.STATUS.EXECUTING) {
        seajs.use(filename) // TAG 调用use方法调用
      }
      exports = Module._cache[_filename] = mod.exports
    }

    return exports
  }

  var _compile = Module.prototype._compile

  Module.prototype._compile = function(content, filename) {
    moduleStack.push(this)
    try {
      return _compile.call(this, content, filename)
    }
    finally {
      moduleStack.pop()
    }
  }
}

function attach() {
  seajs.on("request", requestListener)
  seajs.on("define", defineListener)
}

function requestListener(data) {
  var requestUri = pure(data.requestUri)
  var ext = path.extname(requestUri)
  //process.stdout.write("requestUri = " + requestUri + "\n")

  if (ext === ".js") {
    // Use native `require` instead of script-inserted version
    nativeLoad(requestUri)
    data.onRequest()
    data.requested = true
  }
  // Throw error if this function is the last request handler
  else if (seajs.data.events["request"].length === 1) {
    throw new Error("Do NOT support to load this file in node environment: "
        + requestUri)
  }
}

function defineListener(data) {
  if (!data.uri) {
    var derivedUri = normalize(moduleStack[moduleStack.length - 1].id)
    data.uri = uriCache[derivedUri] || derivedUri
  }
}

function keep() {
  var _off = seajs.off
  var events = seajs.data.events

  seajs.off = function(name, callback) {
    // Remove *all* events
    if (!(name || callback)) {
      // For Node.js to work properly
      for (var prop in events) {
        delete events[prop]
      }
    }
    else {
      _off(name, callback)
    }

    attach()
    return seajs
  }
}

function pure(uri) {
  // Remove timestamp etc
  var ret = uri.replace(/\?.*$/, "")

  // Cache it
  if (ret !== uri) {
    uriCache[ret] = uri
  }
  return ret
}

