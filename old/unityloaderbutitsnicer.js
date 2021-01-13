'use strict';
var UnityLoader = UnityLoader || {
  compatibilityCheck : function(data, callback, scopeIn) {
    if (UnityLoader.SystemInfo.hasWebGL) {
      if (UnityLoader.SystemInfo.mobile) {
        data.popup("Please note that Unity WebGL is not currently supported on mobiles. Press OK if you wish to continue anyway.", [{
          text : "OK",
          callback : callback
        }]);
      } else {
        if (["Firefox", "Chrome", "Safari"].indexOf(UnityLoader.SystemInfo.browser) == -1) {
          data.popup("Please note that your browser is not currently supported for this Unity WebGL content. Press OK if you wish to continue anyway.", [{
            text : "OK",
            callback : callback
          }]);
        } else {
          callback();
        }
      }
    } else {
      data.popup("Your browser does not support WebGL", [{
        text : "OK",
        callback : scopeIn
      }]);
    }
  },
  Blobs : {},
  loadCode : function(content, callback, url) {
    /** @type {string} */
    var n = [].slice.call(UnityLoader.Cryptography.md5(content)).map(function(pingErr) {
      return ("0" + pingErr.toString(16)).substr(-2);
    }).join("");
    /** @type {!Element} */
    var embedscript = document.createElement("script");
    /** @type {string} */
    var src = URL.createObjectURL(new Blob(['UnityLoader["' + n + '"]=', content], {
      type : "text/javascript"
    }));
    UnityLoader.Blobs[src] = url;
    /** @type {string} */
    embedscript.src = src;
    /**
     * @return {undefined}
     */
    embedscript.onload = function() {
      URL.revokeObjectURL(src);
      callback(n);
    };
    document.body.appendChild(embedscript);
  },
  allocateHeapJob : function(self, t) {
    var BOARDS_PER_PAGE = self.TOTAL_STACK || 5242880;
    var len = self.TOTAL_MEMORY || (self.buffer ? self.buffer.byteLength : 268435456);
    /** @type {number} */
    var ps = 65536;
    /** @type {number} */
    var j = 16777216;
    /** @type {number} */
    var i = ps;
    for (; i < len || i < 2 * BOARDS_PER_PAGE;) {
      /** @type {number} */
      i = i + (i < j ? i : j);
    }
    if (i != len) {
      self.printErr("increasing TOTAL_MEMORY to " + i + " to be compliant with the asm.js spec (and given that TOTAL_STACK=" + BOARDS_PER_PAGE + ")");
    }
    /** @type {number} */
    len = i;
    if (t.parameters.useWasm) {
      self.wasmMemory = new WebAssembly.Memory({
        initial : len / ps,
        maximum : len / ps
      });
      self.buffer = self.wasmMemory.buffer;
    } else {
      if (self.buffer) {
        if (self.buffer.byteLength != len) {
          self.printErr("provided buffer should be " + len + " bytes, but it is " + self.buffer.byteLength + ", reallocating the buffer");
          /** @type {!ArrayBuffer} */
          self.buffer = new ArrayBuffer(len);
        }
      } else {
        /** @type {!ArrayBuffer} */
        self.buffer = new ArrayBuffer(len);
      }
    }
    self.TOTAL_MEMORY = self.buffer.byteLength;
    t.complete();
  },
  setupIndexedDBJob : function(scope, elem) {
    /**
     * @param {!Object} s
     * @return {undefined}
     */
    function close(s) {
      if (!close.called) {
        /** @type {boolean} */
        close.called = true;
        /** @type {!Object} */
        scope.indexedDB = s;
        elem.complete();
      }
    }
    try {
      var val = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
      var reqProxy = val.open("/idbfs-test");
      /**
       * @param {!Event} event
       * @return {undefined}
       */
      reqProxy.onerror = function(event) {
        event.preventDefault();
        close();
      };
      /**
       * @return {undefined}
       */
      reqProxy.onsuccess = function() {
        reqProxy.result.close();
        close(val);
      };
      setTimeout(close, 1e3);
    } catch (e) {
      close();
    }
  },
  processWasmCodeJob : function(e, t) {
    e.wasmBinary = UnityLoader.Job.result(e, "downloadWasmCode");
    t.complete();
  },
  processWasmFrameworkJob : function(e, t) {
    UnityLoader.loadCode(UnityLoader.Job.result(e, "downloadWasmFramework"), function(resizerType) {
      UnityLoader[resizerType](e);
      t.complete();
    }, {
      Module : e,
      url : e.wasmFrameworkUrl
    });
  },
  processAsmCodeJob : function(options, fromOptions) {
    var minifyOptionsForStylesheet = UnityLoader.Job.result(options, "downloadAsmCode");
    UnityLoader.loadCode(Math.fround ? minifyOptionsForStylesheet : UnityLoader.Utils.optimizeMathFround(minifyOptionsForStylesheet), function(cluster_id) {
      options.asm = UnityLoader[cluster_id];
      fromOptions.complete();
    }, {
      Module : options,
      url : options.asmCodeUrl
    });
  },
  processAsmFrameworkJob : function(e, t) {
    UnityLoader.loadCode(UnityLoader.Job.result(e, "downloadAsmFramework"), function(resizerType) {
      UnityLoader[resizerType](e);
      t.complete();
    }, {
      Module : e,
      url : e.asmFrameworkUrl
    });
  },
  processAsmMemoryJob : function(response, socket) {
    /** @type {number} */
    response.memoryInitializerRequest.status = 200;
    response.memoryInitializerRequest.response = UnityLoader.Job.result(response, "downloadAsmMemory");
    if (response.memoryInitializerRequest.callback) {
      response.memoryInitializerRequest.callback();
    }
    socket.complete();
  },
  processDataJob : function(result, mergeCallback) {
    var b = UnityLoader.Job.result(result, "downloadData");
    /** @type {!DataView} */
    var view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    /** @type {number} */
    var offset = 0;
    /** @type {string} */
    var imgTagStr = "UnityWebData1.0\x00";
    if (!String.fromCharCode.apply(null, b.subarray(offset, offset + imgTagStr.length)) == imgTagStr) {
      throw "unknown data format";
    }
    /** @type {number} */
    offset = offset + imgTagStr.length;
    /** @type {number} */
    var fetchSize = view.getUint32(offset, true);
    /** @type {number} */
    offset = offset + 4;
    for (; offset < fetchSize;) {
      /** @type {number} */
      var ofs = view.getUint32(offset, true);
      /** @type {number} */
      offset = offset + 4;
      /** @type {number} */
      var nleft = view.getUint32(offset, true);
      /** @type {number} */
      offset = offset + 4;
      /** @type {number} */
      var length = view.getUint32(offset, true);
      /** @type {number} */
      offset = offset + 4;
      /** @type {string} */
      var key = String.fromCharCode.apply(null, b.subarray(offset, offset + length));
      /** @type {number} */
      offset = offset + length;
      /** @type {number} */
      var i = 0;
      /** @type {number} */
      var j = key.indexOf("/", i) + 1;
      for (; j > 0; i = j, j = key.indexOf("/", i) + 1) {
        result.FS_createPath(key.substring(0, i), key.substring(i, j - 1), true, true);
      }
      result.FS_createDataFile(key, null, b.subarray(ofs, ofs + nleft), true, true, true);
    }
    result.removeRunDependency("processDataJob");
    mergeCallback.complete();
  },
  downloadJob : function(success_message, $scope) {
    var request = $scope.parameters.objParameters ? new UnityLoader.XMLHttpRequest($scope.parameters.objParameters) : new XMLHttpRequest;
    request.open("GET", $scope.parameters.url);
    /** @type {string} */
    request.responseType = "arraybuffer";
    /**
     * @return {undefined}
     */
    request.onload = function() {
      UnityLoader.Compression.decompress(new Uint8Array(request.response), function(value) {
        $scope.complete(value);
      });
    };
    if ($scope.parameters.onprogress) {
      request.addEventListener("progress", $scope.parameters.onprogress);
    }
    if ($scope.parameters.onload) {
      request.addEventListener("load", $scope.parameters.onload);
    }
    request.send();
  },
  scheduleBuildDownloadJob : function(self, component, id) {
    UnityLoader.Progress.update(self, component);
    UnityLoader.Job.schedule(self, component, [], UnityLoader.downloadJob, {
      url : self.resolveBuildUrl(self[id]),
      onprogress : function(data) {
        UnityLoader.Progress.update(self, component, data);
      },
      onload : function(data) {
        UnityLoader.Progress.update(self, component, data);
      },
      objParameters : self.companyName && self.productName && self.cacheControl && self.cacheControl[id] ? {
        companyName : self.companyName,
        productName : self.productName,
        cacheControl : self.cacheControl[id]
      } : null
    });
  },
  loadModule : function(options) {
    if (options.useWasm = options.wasmCodeUrl && UnityLoader.SystemInfo.hasWasm, options.useWasm) {
      UnityLoader.scheduleBuildDownloadJob(options, "downloadWasmCode", "wasmCodeUrl");
      UnityLoader.Job.schedule(options, "processWasmCode", ["downloadWasmCode"], UnityLoader.processWasmCodeJob);
      UnityLoader.scheduleBuildDownloadJob(options, "downloadWasmFramework", "wasmFrameworkUrl");
      UnityLoader.Job.schedule(options, "processWasmFramework", ["downloadWasmFramework", "processWasmCode", "setupIndexedDB"], UnityLoader.processWasmFrameworkJob);
    } else {
      if (!options.asmCodeUrl) {
        throw "WebAssembly support is not detected in this browser.";
      }
      UnityLoader.scheduleBuildDownloadJob(options, "downloadAsmCode", "asmCodeUrl");
      UnityLoader.Job.schedule(options, "processAsmCode", ["downloadAsmCode"], UnityLoader.processAsmCodeJob);
      UnityLoader.scheduleBuildDownloadJob(options, "downloadAsmMemory", "asmMemoryUrl");
      UnityLoader.Job.schedule(options, "processAsmMemory", ["downloadAsmMemory"], UnityLoader.processAsmMemoryJob);
      options.memoryInitializerRequest = {
        addEventListener : function(event, callback) {
          /** @type {!Function} */
          options.memoryInitializerRequest.callback = callback;
        }
      };
      if (options.asmLibraryUrl) {
        /** @type {!Array<?>} */
        options.dynamicLibraries = [options.asmLibraryUrl].map(options.resolveBuildUrl);
      }
      UnityLoader.scheduleBuildDownloadJob(options, "downloadAsmFramework", "asmFrameworkUrl");
      UnityLoader.Job.schedule(options, "processAsmFramework", ["downloadAsmFramework", "processAsmCode", "setupIndexedDB"], UnityLoader.processAsmFrameworkJob);
    }
    UnityLoader.scheduleBuildDownloadJob(options, "downloadData", "dataUrl");
    UnityLoader.Job.schedule(options, "setupIndexedDB", [], UnityLoader.setupIndexedDBJob);
    options.preRun.push(function() {
      options.addRunDependency("processDataJob");
      UnityLoader.Job.schedule(options, "processData", ["downloadData"], UnityLoader.processDataJob);
    });
  },
  instantiate : function(params, id, data) {
    /**
     * @param {!Element} element
     * @param {!Object} self
     * @return {?}
     */
    function init(element, self) {
      if ("string" == typeof element && !(element = document.getElementById(element))) {
        return false;
      }
      /** @type {string} */
      element.innerHTML = "";
      /** @type {number} */
      element.style.border = element.style.margin = element.style.padding = 0;
      if ("static" == getComputedStyle(element).getPropertyValue("position")) {
        /** @type {string} */
        element.style.position = "relative";
      }
      element.style.width = self.width || element.style.width;
      element.style.height = self.height || element.style.height;
      /** @type {!Element} */
      self.container = element;
      var data = self.Module;
      return data.canvas = document.createElement("canvas"), data.canvas.style.width = "100%", data.canvas.style.height = "100%", data.canvas.addEventListener("contextmenu", function(event) {
        event.preventDefault();
      }), data.canvas.id = "#canvas", element.appendChild(data.canvas), self.compatibilityCheck(self, function() {
        /** @type {!XMLHttpRequest} */
        var xhr = new XMLHttpRequest;
        xhr.open("GET", self.url, true);
        /** @type {string} */
        xhr.responseType = "text";
        /**
         * @return {undefined}
         */
        xhr.onerror = function() {
          data.print("Could not download " + self.url);
          if (0 == document.URL.indexOf("file:")) {
            alert("It seems your browser does not support running Unity WebGL content from file:// urls. Please upload it to an http server, or try a different browser.");
          }
        };
        /**
         * @return {?}
         */
        xhr.onload = function() {
          /** @type {*} */
          var parameters = JSON.parse(xhr.responseText);
          var p;
          for (p in parameters) {
            if ("undefined" == typeof data[p]) {
              data[p] = parameters[p];
            }
          }
          /** @type {boolean} */
          var s = false;
          /** @type {number} */
          var i = 0;
          for (; i < data.graphicsAPI.length; i++) {
            var value = data.graphicsAPI[i];
            if ("WebGL 2.0" == value && 2 == UnityLoader.SystemInfo.hasWebGL) {
              /** @type {boolean} */
              s = true;
            } else {
              if ("WebGL 1.0" == value && UnityLoader.SystemInfo.hasWebGL >= 1) {
                /** @type {boolean} */
                s = true;
              } else {
                data.print("Warning: Unsupported graphics API " + value);
              }
            }
          }
          return s ? (element.style.background = data.backgroundUrl ? "center/cover url('" + data.resolveBuildUrl(data.backgroundUrl) + "')" : data.backgroundColor ? " " + data.backgroundColor : "", self.onProgress(self, 0), void UnityLoader.loadModule(data)) : void self.popup("Your browser does not support any of the required graphics API for this content: " + data.graphicsAPI, [{
            text : "OK"
          }]);
        };
        xhr.send();
      }, function() {
        data.print("Instantiation of the '" + id + "' terminated due to the failed compatibility check.");
      }), true;
    }
    var options = {
      url : id,
      onProgress : UnityLoader.Progress.handler,
      compatibilityCheck : UnityLoader.compatibilityCheck,
      Module : {
        preRun : [],
        postRun : [],
        print : function(reply) {
          console.log(reply);
        },
        printErr : function(e) {
          console.error(e);
        },
        Jobs : {},
        buildDownloadProgress : {},
        resolveBuildUrl : function(options) {
          return options.match(/(http|https|ftp|file):\/\//) ? options : id.substring(0, id.lastIndexOf("/") + 1) + options;
        }
      },
      SetFullscreen : function() {
        if (options.Module.SetFullscreen) {
          return options.Module.SetFullscreen.apply(options.Module, arguments);
        }
      },
      SendMessage : function() {
        if (options.Module.SendMessage) {
          return options.Module.SendMessage.apply(options.Module, arguments);
        }
      }
    };
    options.Module.gameInstance = options;
    /**
     * @param {string} callback
     * @param {?} y
     * @return {?}
     */
    options.popup = function(callback, y) {
      return UnityLoader.Error.popup(options, callback, y);
    };
    options.Module.postRun.push(function() {
      options.onProgress(options, 1);
    });
    var i;
    for (i in data) {
      if ("Module" == i) {
        var prop;
        for (prop in data[i]) {
          options.Module[prop] = data[i][prop];
        }
      } else {
        options[i] = data[i];
      }
    }
    return init(params, options) || document.addEventListener("DOMContentLoaded", function() {
      init(params, options);
    }), options;
  },
  SystemInfo : function() {
    var nameOffset;
    var verOffset;
    var index;
    /** @type {string} */
    var unknown = "-";
    /** @type {string} */
    var nVer = navigator.appVersion;
    /** @type {string} */
    var ua = navigator.userAgent;
    /** @type {string} */
    var browser = navigator.appName;
    /** @type {string} */
    var version = navigator.appVersion;
    /** @type {number} */
    var d = parseInt(navigator.appVersion, 10);
    if ((verOffset = ua.indexOf("Opera")) != -1) {
      /** @type {string} */
      browser = "Opera";
      /** @type {string} */
      version = ua.substring(verOffset + 6);
      if ((verOffset = ua.indexOf("Version")) != -1) {
        /** @type {string} */
        version = ua.substring(verOffset + 8);
      }
    } else {
      if ((verOffset = ua.indexOf("MSIE")) != -1) {
        /** @type {string} */
        browser = "Microsoft Internet Explorer";
        /** @type {string} */
        version = ua.substring(verOffset + 5);
      } else {
        if ((verOffset = ua.indexOf("Chrome")) != -1) {
          /** @type {string} */
          browser = "Chrome";
          /** @type {string} */
          version = ua.substring(verOffset + 7);
        } else {
          if ((verOffset = ua.indexOf("Safari")) != -1) {
            /** @type {string} */
            browser = "Safari";
            /** @type {string} */
            version = ua.substring(verOffset + 7);
            if ((verOffset = ua.indexOf("Version")) != -1) {
              /** @type {string} */
              version = ua.substring(verOffset + 8);
            }
          } else {
            if ((verOffset = ua.indexOf("Firefox")) != -1) {
              /** @type {string} */
              browser = "Firefox";
              /** @type {string} */
              version = ua.substring(verOffset + 8);
            } else {
              if (ua.indexOf("Trident/") != -1) {
                /** @type {string} */
                browser = "Microsoft Internet Explorer";
                /** @type {string} */
                version = ua.substring(ua.indexOf("rv:") + 3);
              } else {
                if ((nameOffset = ua.lastIndexOf(" ") + 1) < (verOffset = ua.lastIndexOf("/"))) {
                  /** @type {string} */
                  browser = ua.substring(nameOffset, verOffset);
                  /** @type {string} */
                  version = ua.substring(verOffset + 1);
                  if (browser.toLowerCase() == browser.toUpperCase()) {
                    /** @type {string} */
                    browser = navigator.appName;
                  }
                }
              }
            }
          }
        }
      }
    }
    if ((index = version.indexOf(";")) != -1) {
      /** @type {string} */
      version = version.substring(0, index);
    }
    if ((index = version.indexOf(" ")) != -1) {
      /** @type {string} */
      version = version.substring(0, index);
    }
    if ((index = version.indexOf(")")) != -1) {
      /** @type {string} */
      version = version.substring(0, index);
    }
    /** @type {number} */
    d = parseInt("" + version, 10);
    if (isNaN(d)) {
      /** @type {string} */
      version = "" + parseFloat(navigator.appVersion);
      /** @type {number} */
      d = parseInt(navigator.appVersion, 10);
    } else {
      /** @type {string} */
      version = "" + parseFloat(version);
    }
    /** @type {boolean} */
    var mobile = /Mobile|mini|Fennec|Android|iP(ad|od|hone)/.test(nVer);
    /** @type {string} */
    var os = unknown;
    /** @type {!Array} */
    var clientStrings = [{
      s : "Windows 3.11",
      r : /Win16/
    }, {
      s : "Windows 95",
      r : /(Windows 95|Win95|Windows_95)/
    }, {
      s : "Windows ME",
      r : /(Win 9x 4.90|Windows ME)/
    }, {
      s : "Windows 98",
      r : /(Windows 98|Win98)/
    }, {
      s : "Windows CE",
      r : /Windows CE/
    }, {
      s : "Windows 2000",
      r : /(Windows NT 5.0|Windows 2000)/
    }, {
      s : "Windows XP",
      r : /(Windows NT 5.1|Windows XP)/
    }, {
      s : "Windows Server 2003",
      r : /Windows NT 5.2/
    }, {
      s : "Windows Vista",
      r : /Windows NT 6.0/
    }, {
      s : "Windows 7",
      r : /(Windows 7|Windows NT 6.1)/
    }, {
      s : "Windows 8.1",
      r : /(Windows 8.1|Windows NT 6.3)/
    }, {
      s : "Windows 8",
      r : /(Windows 8|Windows NT 6.2)/
    }, {
      s : "Windows 10",
      r : /(Windows 10|Windows NT 10.0)/
    }, {
      s : "Windows NT 4.0",
      r : /(Windows NT 4.0|WinNT4.0|WinNT|Windows NT)/
    }, {
      s : "Windows ME",
      r : /Windows ME/
    }, {
      s : "Android",
      r : /Android/
    }, {
      s : "Open BSD",
      r : /OpenBSD/
    }, {
      s : "Sun OS",
      r : /SunOS/
    }, {
      s : "Linux",
      r : /(Linux|X11)/
    }, {
      s : "iOS",
      r : /(iPhone|iPad|iPod)/
    }, {
      s : "Mac OS X",
      r : /Mac OS X/
    }, {
      s : "Mac OS",
      r : /(MacPPC|MacIntel|Mac_PowerPC|Macintosh)/
    }, {
      s : "QNX",
      r : /QNX/
    }, {
      s : "UNIX",
      r : /UNIX/
    }, {
      s : "BeOS",
      r : /BeOS/
    }, {
      s : "OS/2",
      r : /OS\/2/
    }, {
      s : "Search Bot",
      r : /(nuhk|Googlebot|Yammybot|Openbot|Slurp|MSNBot|Ask Jeeves\/Teoma|ia_archiver)/
    }];
    var id;
    for (id in clientStrings) {
      var cs = clientStrings[id];
      if (cs.r.test(ua)) {
        os = cs.s;
        break;
      }
    }
    /** @type {string} */
    var osVersion = unknown;
    switch(/Windows/.test(os) && (osVersion = /Windows (.*)/.exec(os)[1], os = "Windows"), os) {
      case "Mac OS X":
        /** @type {string} */
        osVersion = /Mac OS X (10[\._\d]+)/.exec(ua)[1];
        break;
      case "Android":
        /** @type {string} */
        osVersion = /Android ([\._\d]+)/.exec(ua)[1];
        break;
      case "iOS":
        /** @type {(Array<string>|null)} */
        osVersion = /OS (\d+)_(\d+)_?(\d+)?/.exec(nVer);
        /** @type {string} */
        osVersion = osVersion[1] + "." + osVersion[2] + "." + (0 | osVersion[3]);
    }
    return {
      width : screen.width ? screen.width : 0,
      height : screen.height ? screen.height : 0,
      browser : browser,
      browserVersion : version,
      mobile : mobile,
      os : os,
      osVersion : osVersion,
      gpu : function() {
        /** @type {!Element} */
        var canvas = document.createElement("canvas");
        var gl = canvas.getContext("experimental-webgl");
        if (gl) {
          var extensionDebugRendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
          if (extensionDebugRendererInfo) {
            return gl.getParameter(extensionDebugRendererInfo.UNMASKED_RENDERER_WEBGL);
          }
        }
        return unknown;
      }(),
      language : window.navigator.userLanguage || window.navigator.language,
      hasWebGL : function() {
        if (!window.WebGLRenderingContext) {
          return 0;
        }
        /** @type {!Element} */
        var canvas = document.createElement("canvas");
        var gl = canvas.getContext("webgl2");
        return gl ? 2 : (gl = canvas.getContext("experimental-webgl2"), gl ? 2 : (gl = canvas.getContext("webgl"), gl || (gl = canvas.getContext("experimental-webgl")) ? 1 : 0));
      }(),
      hasCursorLock : function() {
        /** @type {!Element} */
        var canvas = document.createElement("canvas");
        return canvas.requestPointerLock || canvas.mozRequestPointerLock || canvas.webkitRequestPointerLock || canvas.msRequestPointerLock ? 1 : 0;
      }(),
      hasFullscreen : function() {
        /** @type {!Element} */
        var element = document.createElement("canvas");
        return (element.requestFullScreen || element.mozRequestFullScreen || element.msRequestFullscreen || element.webkitRequestFullScreen) && (browser.indexOf("Safari") == -1 || version >= 10.1) ? 1 : 0;
      }(),
      hasWasm : "object" == typeof WebAssembly && "function" == typeof WebAssembly.validate && "function" == typeof WebAssembly.compile
    };
  }(),
  Error : {
    init : function() {
      return Error.stackTraceLimit = 50, window.addEventListener("error", function(url) {
        var options = UnityLoader.Error.getModule(url);
        if (!options) {
          return UnityLoader.Error.handler(url);
        }
        var peer = options.useWasm ? options.wasmSymbolsUrl : options.asmSymbolsUrl;
        if (!peer) {
          return UnityLoader.Error.handler(url, options);
        }
        /** @type {!XMLHttpRequest} */
        var xhr = new XMLHttpRequest;
        xhr.open("GET", options.resolveBuildUrl(peer));
        /** @type {string} */
        xhr.responseType = "arraybuffer";
        /**
         * @return {undefined}
         */
        xhr.onload = function() {
          UnityLoader.loadCode(UnityLoader.Compression.decompress(new Uint8Array(xhr.response)), function(ballNumber) {
            options.demangleSymbol = UnityLoader[ballNumber]();
            UnityLoader.Error.handler(url, options);
          });
        };
        xhr.send();
      }), true;
    }(),
    stackTraceFormat : navigator.userAgent.indexOf("Chrome") != -1 ? "(\\s+at\\s+)(([\\w\\d_\\.]*?)([\\w\\d_$]+)(/[\\w\\d_\\./]+|))(\\s+\\[.*\\]|)\\s*\\((blob:.*)\\)" : "(\\s*)(([\\w\\d_\\.]*?)([\\w\\d_$]+)(/[\\w\\d_\\./]+|))(\\s+\\[.*\\]|)\\s*@(blob:.*)",
    stackTraceFormatWasm : navigator.userAgent.indexOf("Chrome") != -1 ? "((\\s+at\\s*)\\s\\(<WASM>\\[(\\d+)\\]\\+\\d+\\))()" : "((\\s*)wasm-function\\[(\\d+)\\])@(blob:.*)",
    blobParseRegExp : new RegExp("^(blob:.*)(:\\d+:\\d+)$"),
    getModule : function(module) {
      var path_parts = module.message.match(new RegExp(this.stackTraceFormat, "g"));
      var p;
      for (p in path_parts) {
        var alllinesArray = path_parts[p].match(new RegExp("^" + this.stackTraceFormat + "$"));
        var o = alllinesArray[7].match(this.blobParseRegExp);
        if (o && UnityLoader.Blobs[o[1]] && UnityLoader.Blobs[o[1]].Module) {
          return UnityLoader.Blobs[o[1]].Module;
        }
      }
    },
    demangle : function(line, text) {
      var url = line.message;
      return text ? (url = url.replace(new RegExp(this.stackTraceFormat, "g"), function(subTopic) {
        var urls = subTopic.match(new RegExp("^" + this.stackTraceFormat + "$"));
        var isSaveAsUrl = urls[7].match(this.blobParseRegExp);
        var year = text.demangleSymbol ? text.demangleSymbol(urls[4]) : urls[4];
        var type = isSaveAsUrl && UnityLoader.Blobs[isSaveAsUrl[1]] && UnityLoader.Blobs[isSaveAsUrl[1]].url ? UnityLoader.Blobs[isSaveAsUrl[1]].url : "blob";
        return urls[1] + year + (urls[2] != year ? " [" + urls[2] + "]" : "") + " (" + (isSaveAsUrl ? type.substr(type.lastIndexOf("/") + 1) + isSaveAsUrl[2] : urls[7]) + ")";
      }.bind(this)), text.useWasm && (url = url.replace(new RegExp(this.stackTraceFormatWasm, "g"), function(subTopic) {
        var row = subTopic.match(new RegExp("^" + this.stackTraceFormatWasm + "$"));
        var o = text.demangleSymbol ? text.demangleSymbol(row[3]) : row[3];
        var config = row[4].match(this.blobParseRegExp);
        var type = config && UnityLoader.Blobs[config[1]] && UnityLoader.Blobs[config[1]].url ? UnityLoader.Blobs[config[1]].url : "blob";
        return (o == row[3] ? row[1] : row[2] + o + " [wasm:" + row[3] + "]") + (row[4] ? " (" + (config ? type.substr(type.lastIndexOf("/") + 1) + config[2] : row[4]) + ")" : "");
      }.bind(this))), url) : url;
    },
    handler : function(options, data) {
      var message = data ? this.demangle(options, data) : options.message;
      if (!(data && data.errorhandler && data.errorhandler(message, options.filename, options.lineno) || (console.log("Invoking error handler due to\n" + message), "function" == typeof dump && dump("Invoking error handler due to\n" + message), message.indexOf("UnknownError") != -1 || message.indexOf("Program terminated with exit(0)") != -1 || this.didShowErrorMessage))) {
        /** @type {string} */
        message = "An error occurred running the Unity content on this page. See your browser JavaScript console for more info. The error was:\n" + message;
        if (message.indexOf("DISABLE_EXCEPTION_CATCHING") != -1) {
          /** @type {string} */
          message = "An exception has occurred, but exception handling has been disabled in this build. If you are the developer of this content, enable exceptions in your project WebGL player settings to be able to catch the exception or see the stack trace.";
        } else {
          if (message.indexOf("Cannot enlarge memory arrays") != -1) {
            /** @type {string} */
            message = "Out of memory. If you are the developer of this content, try allocating more memory to your WebGL build in the WebGL player settings.";
          } else {
            if (!(message.indexOf("Invalid array buffer length") == -1 && message.indexOf("Invalid typed array length") == -1 && message.indexOf("out of memory") == -1)) {
              /** @type {string} */
              message = "The browser could not allocate enough memory for the WebGL content. If you are the developer of this content, try allocating less memory to your WebGL build in the WebGL player settings.";
            }
          }
        }
        alert(message);
        /** @type {boolean} */
        this.didShowErrorMessage = true;
      }
    },
    popup : function(e, b, options) {
      options = options || [{
        text : "OK"
      }];
      /** @type {!Element} */
      var c = document.createElement("div");
      /** @type {string} */
      c.style.cssText = "position: absolute; top: 50%; left: 50%; -webkit-transform: translate(-50%, -50%); transform: translate(-50%, -50%); text-align: center; border: 1px solid black; padding: 5px; background: #E8E8E8";
      /** @type {!Element} */
      var cn = document.createElement("span");
      /** @type {string} */
      cn.textContent = b;
      c.appendChild(cn);
      c.appendChild(document.createElement("br"));
      /** @type {number} */
      var i = 0;
      for (; i < options.length; i++) {
        /** @type {!Element} */
        var element = document.createElement("button");
        if (options[i].text) {
          element.textContent = options[i].text;
        }
        if (options[i].callback) {
          element.onclick = options[i].callback;
        }
        /** @type {string} */
        element.style.margin = "5px";
        element.addEventListener("click", function() {
          e.container.removeChild(c);
        });
        c.appendChild(element);
      }
      e.container.appendChild(c);
    }
  },
  Job : {
    schedule : function(result, name, date, callback, id) {
      id = id || {};
      var data = result.Jobs[name];
      if (data || (data = result.Jobs[name] = {
        dependencies : {},
        dependants : {}
      }), data.callback) {
        throw "[UnityLoader.Job.schedule] job '" + name + "' has been already scheduled";
      }
      if ("function" != typeof callback) {
        throw "[UnityLoader.Job.schedule] job '" + name + "' has invalid callback";
      }
      if ("object" != typeof id) {
        throw "[UnityLoader.Job.schedule] job '" + name + "' has invalid parameters";
      }
      /**
       * @param {?} error
       * @param {?} deviceData
       * @return {undefined}
       */
      data.callback = function(error, deviceData) {
        /** @type {number} */
        data.starttime = performance.now();
        callback(error, deviceData);
      };
      /** @type {!Object} */
      data.parameters = id;
      /**
       * @param {number} errorValue
       * @return {undefined}
       */
      data.complete = function(errorValue) {
        /** @type {number} */
        data.endtime = performance.now();
        data.result = {
          value : errorValue
        };
        var pid;
        for (pid in data.dependants) {
          var node = result.Jobs[pid];
          /** @type {boolean} */
          node.dependencies[name] = data.dependants[pid] = false;
          /** @type {boolean} */
          var context = "function" != typeof node.callback;
          var i;
          for (i in node.dependencies) {
            context = context || node.dependencies[i];
          }
          if (!context) {
            if (node.executed) {
              throw "[UnityLoader.Job.schedule] job '" + name + "' has already been executed";
            }
            /** @type {boolean} */
            node.executed = true;
            setTimeout(node.callback.bind(null, result, node), 0);
          }
        }
      };
      /** @type {boolean} */
      var i = false;
      date.forEach(function(key) {
        var pkg = result.Jobs[key];
        if (!pkg) {
          pkg = result.Jobs[key] = {
            dependencies : {},
            dependants : {}
          };
        }
        if (data.dependencies[key] = pkg.dependants[name] = !pkg.result) {
          /** @type {boolean} */
          i = true;
        }
      });
      if (!i) {
        /** @type {boolean} */
        data.executed = true;
        setTimeout(data.callback.bind(null, result, data), 0);
      }
    },
    result : function(t, obj) {
      var d = t.Jobs[obj];
      if (!d) {
        throw "[UnityLoader.Job.result] job '" + obj + "' does not exist";
      }
      if ("object" != typeof d.result) {
        throw "[UnityLoader.Job.result] job '" + obj + "' has invalid result";
      }
      return d.result.value;
    }
  },
  XMLHttpRequest : function() {
    /**
     * @param {string} dataURL
     * @return {undefined}
     */
    function then(dataURL) {
      console.log("[UnityCache] " + dataURL);
    }
    /**
     * @param {string} name
     * @return {?}
     */
    function c(name) {
      return c.link = c.link || document.createElement("a"), c.link.href = name, c.link.href;
    }
    /**
     * @param {string} url
     * @return {?}
     */
    function isCrossDomain(url) {
      /** @type {(Array<string>|null)} */
      var current = window.location.href.match(/^[a-z]+:\/\/[^\/]+/);
      return !current || url.lastIndexOf(current[0], 0);
    }
    /**
     * @return {undefined}
     */
    function init() {
      /**
       * @param {string} data
       * @return {undefined}
       */
      function render(data) {
        if ("undefined" == typeof that.database) {
          /** @type {string} */
          that.database = data;
          if (!that.database) {
            then("indexedDB database could not be opened");
          }
          for (; that.queue.length;) {
            var ws = that.queue.shift();
            if (that.database) {
              that.execute.apply(that, ws);
            } else {
              if ("function" == typeof ws.onerror) {
                ws.onerror(new Error("operation cancelled"));
              }
            }
          }
        }
      }
      var that = this;
      /** @type {!Array} */
      that.queue = [];
      try {
        var n = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
        var req = n.open(i);
        /**
         * @param {!Event} event
         * @return {undefined}
         */
        req.onupgradeneeded = function(event) {
          var db = event.target.result.createObjectStore(name, {
            keyPath : "url"
          });
          ["version", "company", "product", "updated", "revalidated", "accessed"].forEach(function(indexName) {
            db.createIndex(indexName, indexName);
          });
        };
        /**
         * @param {!Event} event
         * @return {undefined}
         */
        req.onsuccess = function(event) {
          render(event.target.result);
        };
        /**
         * @return {undefined}
         */
        req.onerror = function() {
          render(null);
        };
        setTimeout(req.onerror, 1E3);
      } catch (e) {
        render(null);
      }
    }
    /**
     * @param {string} action
     * @param {string} context
     * @param {string} payload
     * @param {boolean} ts
     * @param {!Function} xhr
     * @return {?}
     */
    function cb(action, context, payload, ts, xhr) {
      var data = {
        url : action,
        version : version,
        company : context,
        product : payload,
        updated : ts,
        revalidated : ts,
        accessed : ts,
        responseHeaders : {},
        xhr : {}
      };
      return xhr && (["Last-Modified", "ETag"].forEach(function(key) {
        data.responseHeaders[key] = xhr.getResponseHeader(key);
      }), ["responseURL", "status", "statusText", "response"].forEach(function(name) {
        data.xhr[name] = xhr[name];
      })), data;
    }
    /**
     * @param {!Object} opts
     * @return {undefined}
     */
    function request(opts) {
      this.cache = {
        enabled : false
      };
      if (opts) {
        this.cache.control = opts.cacheControl;
        this.cache.company = opts.companyName;
        this.cache.product = opts.productName;
      }
      /** @type {!XMLHttpRequest} */
      this.xhr = new XMLHttpRequest(opts);
      this.xhr.addEventListener("load", function() {
        var xhr = this.xhr;
        var data = this.cache;
        if (data.enabled && !data.revalidated) {
          if (304 == xhr.status) {
            data.result.revalidated = data.result.accessed;
            /** @type {boolean} */
            data.revalidated = true;
            router.execute("put", [data.result]);
            then("'" + data.result.url + "' successfully revalidated and served from the indexedDB cache");
          } else {
            if (200 == xhr.status) {
              data.result = cb(data.result.url, data.company, data.product, data.result.accessed, xhr);
              /** @type {boolean} */
              data.revalidated = true;
              router.execute("put", [data.result], function(canCreateDiscussions) {
                then("'" + data.result.url + "' successfully downloaded and stored in the indexedDB cache");
              }, function(whatCookies) {
                then("'" + data.result.url + "' successfully downloaded but not stored in the indexedDB cache due to the error: " + whatCookies);
              });
            } else {
              then("'" + data.result.url + "' request failed with status: " + xhr.status + " " + xhr.statusText);
            }
          }
        }
      }.bind(this));
    }
    /** @type {string} */
    var i = "UnityCache";
    /** @type {string} */
    var name = "XMLHttpRequest";
    /** @type {number} */
    var version = 1;
    /**
     * @param {string} methodName
     * @param {!Array} x
     * @param {!Function} callback
     * @param {!Function} cb
     * @return {undefined}
     */
    init.prototype.execute = function(methodName, x, callback, cb) {
      if (this.database) {
        try {
          var view = this.database.transaction([name], ["put", "delete", "clear"].indexOf(methodName) != -1 ? "readwrite" : "readonly").objectStore(name);
          if ("openKeyCursor" == methodName) {
            view = view.index(x[0]);
            x = x.slice(1);
          }
          var a = view[methodName].apply(view, x);
          if ("function" == typeof callback) {
            /**
             * @param {!Event} event
             * @return {undefined}
             */
            a.onsuccess = function(event) {
              callback(event.target.result);
            };
          }
          /** @type {!Function} */
          a.onerror = cb;
        } catch (additiveNodes) {
          if ("function" == typeof cb) {
            cb(additiveNodes);
          }
        }
      } else {
        if ("undefined" == typeof this.database) {
          this.queue.push(arguments);
        } else {
          if ("function" == typeof cb) {
            cb(new Error("indexedDB access denied"));
          }
        }
      }
    };
    var router = new init;
    /**
     * @param {?} cmdBuffer
     * @return {?}
     */
    request.prototype.send = function(cmdBuffer) {
      var xhr = this.xhr;
      var props = this.cache;
      /** @type {!Arguments} */
      var args = arguments;
      return props.enabled = props.enabled && "arraybuffer" == xhr.responseType && !cmdBuffer, props.enabled ? void router.execute("get", [props.result.url], function(item) {
        if (!item || item.version != version) {
          return void xhr.send.apply(xhr, args);
        }
        if (props.result = item, props.result.accessed = Date.now(), "immutable" == props.control) {
          /** @type {boolean} */
          props.revalidated = true;
          router.execute("put", [props.result]);
          xhr.dispatchEvent(new Event("load"));
          then("'" + props.result.url + "' served from the indexedDB cache without revalidation");
        } else {
          if (isCrossDomain(props.result.url) && (props.result.responseHeaders["Last-Modified"] || props.result.responseHeaders.ETag)) {
            /** @type {!XMLHttpRequest} */
            var xhr = new XMLHttpRequest;
            xhr.open("HEAD", props.result.url);
            /**
             * @return {undefined}
             */
            xhr.onload = function() {
              /** @type {boolean} */
              props.revalidated = ["Last-Modified", "ETag"].every(function(i) {
                return !props.result.responseHeaders[i] || props.result.responseHeaders[i] == xhr.getResponseHeader(i);
              });
              if (props.revalidated) {
                props.result.revalidated = props.result.accessed;
                router.execute("put", [props.result]);
                xhr.dispatchEvent(new Event("load"));
                then("'" + props.result.url + "' successfully revalidated and served from the indexedDB cache");
              } else {
                xhr.send.apply(xhr, args);
              }
            };
            xhr.send();
          } else {
            if (props.result.responseHeaders["Last-Modified"]) {
              xhr.setRequestHeader("If-Modified-Since", props.result.responseHeaders["Last-Modified"]);
              xhr.setRequestHeader("Cache-Control", "no-cache");
            } else {
              if (props.result.responseHeaders.ETag) {
                xhr.setRequestHeader("If-None-Match", props.result.responseHeaders.ETag);
                xhr.setRequestHeader("Cache-Control", "no-cache");
              }
            }
            xhr.send.apply(xhr, args);
          }
        }
      }, function(canCreateDiscussions) {
        xhr.send.apply(xhr, args);
      }) : xhr.send.apply(xhr, args);
    };
    /**
     * @param {string} method
     * @param {string} a
     * @param {string} b
     * @param {?} n
     * @param {?} s
     * @return {?}
     */
    request.prototype.open = function(method, a, b, n, s) {
      return this.cache.result = cb(c(a), this.cache.company, this.cache.product, Date.now()), this.cache.enabled = ["must-revalidate", "immutable"].indexOf(this.cache.control) != -1 && "GET" == method && this.cache.result.url.match("^https?://") && ("undefined" == typeof b || b) && "undefined" == typeof n && "undefined" == typeof s, this.cache.revalidated = false, this.xhr.open.apply(this.xhr, arguments);
    };
    /**
     * @param {string} name
     * @param {string} value
     * @return {?}
     */
    request.prototype.setRequestHeader = function(name, value) {
      return this.cache.enabled = false, this.xhr.setRequestHeader.apply(this.xhr, arguments);
    };
    /** @type {!XMLHttpRequest} */
    var xhr = new XMLHttpRequest;
    var prop;
    for (prop in xhr) {
      if (!request.prototype.hasOwnProperty(prop)) {
        !function(prop) {
          Object.defineProperty(request.prototype, prop, "function" == typeof xhr[prop] ? {
            value : function() {
              return this.xhr[prop].apply(this.xhr, arguments);
            }
          } : {
            get : function() {
              return this.cache.revalidated && this.cache.result.xhr.hasOwnProperty(prop) ? this.cache.result.xhr[prop] : this.xhr[prop];
            },
            set : function(str) {
              this.xhr[prop] = str;
            }
          });
        }(prop);
      }
    }
    return request;
  }(),
  Utils : {
    assert : function(noForm, form1) {
      if (!noForm) {
        abort("Assertion failed: " + form1);
      }
    },
    optimizeMathFround : function(arr, start) {
      console.log("optimizing out Math.fround calls");
      var sel = {
        LOOKING_FOR_MODULE : 0,
        SCANNING_MODULE_VARIABLES : 1,
        SCANNING_MODULE_FUNCTIONS : 2
      };
      /** @type {!Array} */
      var value = ["EMSCRIPTEN_START_ASM", "EMSCRIPTEN_START_FUNCS", "EMSCRIPTEN_END_FUNCS"];
      /** @type {string} */
      var oEl = "var";
      /** @type {string} */
      var colon = "global.Math.fround;";
      /** @type {number} */
      var i = 0;
      /** @type {number} */
      var n = start ? sel.LOOKING_FOR_MODULE : sel.SCANNING_MODULE_VARIABLES;
      /** @type {number} */
      var len = 0;
      /** @type {number} */
      var l = 0;
      for (; n <= sel.SCANNING_MODULE_FUNCTIONS && i < arr.length; i++) {
        if (47 == arr[i] && 47 == arr[i + 1] && 32 == arr[i + 2] && String.fromCharCode.apply(null, arr.subarray(i + 3, i + 3 + value[n].length)) === value[n]) {
          n++;
        } else {
          if (n != sel.SCANNING_MODULE_VARIABLES || l || 61 != arr[i] || String.fromCharCode.apply(null, arr.subarray(i + 1, i + 1 + colon.length)) !== colon) {
            if (l && 40 == arr[i]) {
              /** @type {number} */
              var j = 0;
              for (; j < l && arr[i - 1 - j] == arr[len - j];) {
                j++;
              }
              if (j == l) {
                var cont = arr[i - 1 - j];
                if (cont < 36 || 36 < cont && cont < 48 || 57 < cont && cont < 65 || 90 < cont && cont < 95 || 95 < cont && cont < 97 || 122 < cont) {
                  for (; j; j--) {
                    /** @type {number} */
                    arr[i - j] = 32;
                  }
                }
              }
            }
          } else {
            /** @type {number} */
            len = i - 1;
            for (; 32 != arr[len - l];) {
              l++;
            }
            if (!(l && String.fromCharCode.apply(null, arr.subarray(len - l - oEl.length, len - l)) === oEl)) {
              /** @type {number} */
              len = l = 0;
            }
          }
        }
      }
      return arr;
    }
  },
  Cryptography : {
    crc32 : function(buf) {
      var m = UnityLoader.Cryptography.crc32.module;
      if (!m) {
        /** @type {!ArrayBuffer} */
        var buffer = new ArrayBuffer(16777216);
        var result = function(stdlib, addedRenderer, buffer) {
          /**
           * @param {number} index
           * @param {number} value
           * @return {undefined}
           */
          function _process(index, value) {
            /** @type {number} */
            index = index | 0;
            /** @type {number} */
            value = value | 0;
            /** @type {number} */
            var c = 0;
            /** @type {number} */
            c = table[1024 >> 2] | 0;
            for (; value; index = index + 1 | 0, value = value - 1 | 0) {
              /** @type {number} */
              c = table[(c & 255 ^ str[index]) << 2 >> 2] ^ c >>> 8 ^ 4278190080;
            }
            /** @type {number} */
            table[1024 >> 2] = c;
          }
          "use asm";
          /** @type {!Uint8Array} */
          var str = new stdlib.Uint8Array(buffer);
          /** @type {!Uint32Array} */
          var table = new stdlib.Uint32Array(buffer);
          return {
            process : _process
          };
        }({
          Uint8Array : Uint8Array,
          Uint32Array : Uint32Array
        }, null, buffer);
        m = UnityLoader.Cryptography.crc32.module = {
          buffer : buffer,
          HEAPU8 : new Uint8Array(buffer),
          HEAPU32 : new Uint32Array(buffer),
          process : result.process,
          crc32 : 1024,
          data : 1028
        };
        /** @type {number} */
        var k = 0;
        for (; k < 256; k++) {
          /** @type {number} */
          var l = 255 ^ k;
          /** @type {number} */
          var i = 0;
          for (; i < 8; i++) {
            /** @type {number} */
            l = l >>> 1 ^ (1 & l ? 3988292384 : 0);
          }
          /** @type {number} */
          m.HEAPU32[k] = l;
        }
      }
      /** @type {number} */
      m.HEAPU32[m.crc32 >> 2] = 0;
      /** @type {number} */
      var i = 0;
      for (; i < buf.length;) {
        /** @type {number} */
        var end = Math.min(m.HEAPU8.length - m.data, buf.length - i);
        m.HEAPU8.set(buf.subarray(i, i + end), m.data);
        crc = m.process(m.data, end);
        /** @type {number} */
        i = i + end;
      }
      var blue = m.HEAPU32[m.crc32 >> 2];
      return new Uint8Array([blue >> 24, blue >> 16, blue >> 8, blue]);
    },
    md5 : function(value) {
      var m = UnityLoader.Cryptography.md5.module;
      if (!m) {
        /** @type {!ArrayBuffer} */
        var data = new ArrayBuffer(16777216);
        var options = function(stdlib, addedRenderer, buffer) {
          /**
           * @param {number} y
           * @param {number} value
           * @return {undefined}
           */
          function process(y, value) {
            /** @type {number} */
            y = y | 0;
            /** @type {number} */
            value = value | 0;
            /** @type {number} */
            var m = 0;
            /** @type {number} */
            var g = 0;
            /** @type {number} */
            var j = 0;
            /** @type {number} */
            var i = 0;
            /** @type {number} */
            var message = 0;
            /** @type {number} */
            var flags = 0;
            /** @type {number} */
            var j0 = 0;
            /** @type {number} */
            var u = 0;
            /** @type {number} */
            var offset = 0;
            /** @type {number} */
            var f = 0;
            /** @type {number} */
            var h = 0;
            /** @type {number} */
            var huff = 0;
            /** @type {number} */
            m = c[128] | 0;
            /** @type {number} */
            g = c[129] | 0;
            /** @type {number} */
            j = c[130] | 0;
            /** @type {number} */
            i = c[131] | 0;
            for (; value; y = y + 64 | 0, value = value - 1 | 0) {
              /** @type {number} */
              message = m;
              /** @type {number} */
              flags = g;
              /** @type {number} */
              j0 = j;
              /** @type {number} */
              u = i;
              /** @type {number} */
              f = 0;
              for (; (f | 0) < 512; f = f + 8 | 0) {
                /** @type {number} */
                huff = c[f >> 2] | 0;
                /** @type {number} */
                m = m + (c[f + 4 >> 2] | 0) + (c[y + (huff >>> 14) >> 2] | 0) + ((f | 0) < 128 ? i ^ g & (j ^ i) : (f | 0) < 256 ? j ^ i & (g ^ j) : (f | 0) < 384 ? g ^ j ^ i : j ^ (g | ~i)) | 0;
                /** @type {number} */
                h = (m << (huff & 31) | m >>> 32 - (huff & 31)) + g | 0;
                /** @type {number} */
                m = i;
                /** @type {number} */
                i = j;
                /** @type {number} */
                j = g;
                /** @type {number} */
                g = h;
              }
              /** @type {number} */
              m = m + message | 0;
              /** @type {number} */
              g = g + flags | 0;
              /** @type {number} */
              j = j + j0 | 0;
              /** @type {number} */
              i = i + u | 0;
            }
            /** @type {number} */
            c[128] = m;
            /** @type {number} */
            c[129] = g;
            /** @type {number} */
            c[130] = j;
            /** @type {number} */
            c[131] = i;
          }
          "use asm";
          /** @type {!Uint32Array} */
          var c = new stdlib.Uint32Array(buffer);
          return {
            process : process
          };
        }({
          Uint32Array : Uint32Array
        }, null, data);
        m = UnityLoader.Cryptography.md5.module = {
          buffer : data,
          HEAPU8 : new Uint8Array(data),
          HEAPU32 : new Uint32Array(data),
          process : options.process,
          md5 : 512,
          data : 576
        };
        m.HEAPU32.set(new Uint32Array([7, 3614090360, 65548, 3905402710, 131089, 606105819, 196630, 3250441966, 262151, 4118548399, 327692, 1200080426, 393233, 2821735955, 458774, 4249261313, 524295, 1770035416, 589836, 2336552879, 655377, 4294925233, 720918, 2304563134, 786439, 1804603682, 851980, 4254626195, 917521, 2792965006, 983062, 1236535329, 65541, 4129170786, 393225, 3225465664, 720910, 643717713, 20, 3921069994, 327685, 3593408605, 655369, 38016083, 983054, 3634488961, 262164, 3889429448, 
        589829, 568446438, 917513, 3275163606, 196622, 4107603335, 524308, 1163531501, 851973, 2850285829, 131081, 4243563512, 458766, 1735328473, 786452, 2368359562, 327684, 4294588738, 524299, 2272392833, 720912, 1839030562, 917527, 4259657740, 65540, 2763975236, 262155, 1272893353, 458768, 4139469664, 655383, 3200236656, 851972, 681279174, 11, 3936430074, 196624, 3572445317, 393239, 76029189, 589828, 3654602809, 786443, 3873151461, 983056, 530742520, 131095, 3299628645, 6, 4096336452, 458762, 
        1126891415, 917519, 2878612391, 327701, 4237533241, 786438, 1700485571, 196618, 2399980690, 655375, 4293915773, 65557, 2240044497, 524294, 1873313359, 983050, 4264355552, 393231, 2734768916, 851989, 1309151649, 262150, 4149444226, 720906, 3174756917, 131087, 718787259, 589845, 3951481745]));
      }
      m.HEAPU32.set(new Uint32Array([1732584193, 4023233417, 2562383102, 271733878]), m.md5 >> 2);
      /** @type {number} */
      var index = 0;
      for (; index < value.length;) {
        /** @type {number} */
        var len = Math.min(m.HEAPU8.length - m.data, value.length - index) & -64;
        if (m.HEAPU8.set(value.subarray(index, index + len), m.data), index = index + len, m.process(m.data, len >> 6), value.length - index < 64) {
          if (len = value.length - index, m.HEAPU8.set(value.subarray(value.length - len, value.length), m.data), index = index + len, m.HEAPU8[m.data + len++] = 128, len > 56) {
            /** @type {number} */
            var j = len;
            for (; j < 64; j++) {
              /** @type {number} */
              m.HEAPU8[m.data + j] = 0;
            }
            m.process(m.data, 1);
            /** @type {number} */
            len = 0;
          }
          /** @type {number} */
          j = len;
          for (; j < 64; j++) {
            /** @type {number} */
            m.HEAPU8[m.data + j] = 0;
          }
          var valLength = value.length;
          /** @type {number} */
          var k = 0;
          /** @type {number} */
          j = 56;
          for (; j < 64; j++, k = (224 & valLength) >> 5, valLength = valLength / 256) {
            /** @type {number} */
            m.HEAPU8[m.data + j] = ((31 & valLength) << 3) + k;
          }
          m.process(m.data, 1);
        }
      }
      return new Uint8Array(m.HEAPU8.subarray(m.md5, m.md5 + 16));
    },
    sha1 : function(buffer) {
      var m = UnityLoader.Cryptography.sha1.module;
      if (!m) {
        /** @type {!ArrayBuffer} */
        var data = new ArrayBuffer(16777216);
        var options = function(stdlib, addedRenderer, buffer) {
          /**
           * @param {number} y
           * @param {number} value
           * @return {undefined}
           */
          function process(y, value) {
            /** @type {number} */
            y = y | 0;
            /** @type {number} */
            value = value | 0;
            /** @type {number} */
            var r = 0;
            /** @type {number} */
            var b = 0;
            /** @type {number} */
            var c = 0;
            /** @type {number} */
            var d = 0;
            /** @type {number} */
            var v = 0;
            /** @type {number} */
            var room = 0;
            /** @type {number} */
            var left = 0;
            /** @type {number} */
            var cursor = 0;
            /** @type {number} */
            var type = 0;
            /** @type {number} */
            var vs = 0;
            /** @type {number} */
            var n = 0;
            /** @type {number} */
            var j = 0;
            /** @type {number} */
            r = data[80] | 0;
            /** @type {number} */
            b = data[81] | 0;
            /** @type {number} */
            c = data[82] | 0;
            /** @type {number} */
            d = data[83] | 0;
            /** @type {number} */
            v = data[84] | 0;
            for (; value; y = y + 64 | 0, value = value - 1 | 0) {
              /** @type {number} */
              room = r;
              /** @type {number} */
              left = b;
              /** @type {number} */
              cursor = c;
              /** @type {number} */
              type = d;
              /** @type {number} */
              vs = v;
              /** @type {number} */
              j = 0;
              for (; (j | 0) < 320; j = j + 4 | 0, v = d, d = c, c = b << 30 | b >>> 2, b = r, r = n) {
                if ((j | 0) < 64) {
                  /** @type {number} */
                  n = data[y + j >> 2] | 0;
                  /** @type {number} */
                  n = n << 24 & 4278190080 | n << 8 & 16711680 | n >>> 8 & 65280 | n >>> 24 & 255;
                } else {
                  /** @type {number} */
                  n = data[j - 12 >> 2] ^ data[j - 32 >> 2] ^ data[j - 56 >> 2] ^ data[j - 64 >> 2];
                  /** @type {number} */
                  n = n << 1 | n >>> 31;
                }
                /** @type {number} */
                data[j >> 2] = n;
                /** @type {number} */
                n = n + ((r << 5 | r >>> 27) + v) + ((j | 0) < 80 ? (b & c | ~b & d | 0) + 1518500249 | 0 : (j | 0) < 160 ? (b ^ c ^ d) + 1859775393 | 0 : (j | 0) < 240 ? (b & c | b & d | c & d) + 2400959708 | 0 : (b ^ c ^ d) + 3395469782 | 0) | 0;
              }
              /** @type {number} */
              r = r + room | 0;
              /** @type {number} */
              b = b + left | 0;
              /** @type {number} */
              c = c + cursor | 0;
              /** @type {number} */
              d = d + type | 0;
              /** @type {number} */
              v = v + vs | 0;
            }
            /** @type {number} */
            data[80] = r;
            /** @type {number} */
            data[81] = b;
            /** @type {number} */
            data[82] = c;
            /** @type {number} */
            data[83] = d;
            /** @type {number} */
            data[84] = v;
          }
          "use asm";
          /** @type {!Uint32Array} */
          var data = new stdlib.Uint32Array(buffer);
          return {
            process : process
          };
        }({
          Uint32Array : Uint32Array
        }, null, data);
        m = UnityLoader.Cryptography.sha1.module = {
          buffer : data,
          HEAPU8 : new Uint8Array(data),
          HEAPU32 : new Uint32Array(data),
          process : options.process,
          sha1 : 320,
          data : 384
        };
      }
      m.HEAPU32.set(new Uint32Array([1732584193, 4023233417, 2562383102, 271733878, 3285377520]), m.sha1 >> 2);
      /** @type {number} */
      var offset = 0;
      for (; offset < buffer.length;) {
        /** @type {number} */
        var length = Math.min(m.HEAPU8.length - m.data, buffer.length - offset) & -64;
        if (m.HEAPU8.set(buffer.subarray(offset, offset + length), m.data), offset = offset + length, m.process(m.data, length >> 6), buffer.length - offset < 64) {
          if (length = buffer.length - offset, m.HEAPU8.set(buffer.subarray(buffer.length - length, buffer.length), m.data), offset = offset + length, m.HEAPU8[m.data + length++] = 128, length > 56) {
            /** @type {number} */
            var j = length;
            for (; j < 64; j++) {
              /** @type {number} */
              m.HEAPU8[m.data + j] = 0;
            }
            m.process(m.data, 1);
            /** @type {number} */
            length = 0;
          }
          /** @type {number} */
          j = length;
          for (; j < 64; j++) {
            /** @type {number} */
            m.HEAPU8[m.data + j] = 0;
          }
          var pos = buffer.length;
          /** @type {number} */
          var sx = 0;
          /** @type {number} */
          j = 63;
          for (; j >= 56; j--, sx = (224 & pos) >> 5, pos = pos / 256) {
            /** @type {number} */
            m.HEAPU8[m.data + j] = ((31 & pos) << 3) + sx;
          }
          m.process(m.data, 1);
        }
      }
      /** @type {!Uint8Array} */
      var ret = new Uint8Array(20);
      /** @type {number} */
      j = 0;
      for (; j < ret.length; j++) {
        ret[j] = m.HEAPU8[m.sha1 + (j & -4) + 3 - (3 & j)];
      }
      return ret;
    }
  },
  Progress : {
    Styles : {
      Dark : {
        progressLogoUrl : "data:image/png;base64,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",
        progressEmptyUrl : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI0AAAASCAYAAABmbl0zAAAACXBIWXMAAAsSAAALEgHS3X78AAAATUlEQVRo3u3aIQ4AIAwEQUr4/5cPiyMVBDOj0M2mCKgkGdAwjYCudZzLOLiITYPrCdEgGkSDaEA0iAbRIBpEA6JBNHx1vnL7V4NNwxsbCNMGI3YImu0AAAAASUVORK5CYII=",
        progressFullUrl : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI0AAAASCAYAAABmbl0zAAAACXBIWXMAAAsSAAALEgHS3X78AAAAO0lEQVRo3u3SQREAAAjDMMC/56EB3omEXjtJCg5GAkyDaTANpsE0YBpMg2kwDaYB02AaTINpMA2Yhr8FO18EIBpZMeQAAAAASUVORK5CYII="
      },
      Light : {
        progressLogoUrl : "data:image/png;base64,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",
        progressEmptyUrl : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI0AAAASCAYAAABmbl0zAAAACXBIWXMAAAsSAAALEgHS3X78AAAAUUlEQVRo3u3aMQ4AEAxAUcRJzGb3v1mt3cQglvcmc/NTA3XMFQUuNCPgVk/nahwchE2D6wnRIBpEg2hANIgG0SAaRAOiQTR8lV+5/avBpuGNDcz6A6oq1CgNAAAAAElFTkSuQmCC",
        progressFullUrl : "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAI0AAAASCAYAAABmbl0zAAAACXBIWXMAAAsSAAALEgHS3X78AAAAQElEQVRo3u3SMREAMAgAsVIpnTvj3xlogDmR8PfxftaBgSsBpsE0mAbTYBowDabBNJgG04BpMA2mwTSYBkzDXgP/hgGnr4PpeAAAAABJRU5ErkJggg=="
      }
    },
    handler : function(options, data) {
      if (options.Module) {
        var r = UnityLoader.Progress.Styles[options.Module.splashScreenStyle];
        var x = options.Module.progressLogoUrl ? options.Module.resolveBuildUrl(options.Module.progressLogoUrl) : r.progressLogoUrl;
        var o = options.Module.progressEmptyUrl ? options.Module.resolveBuildUrl(options.Module.progressEmptyUrl) : r.progressEmptyUrl;
        var a = options.Module.progressFullUrl ? options.Module.resolveBuildUrl(options.Module.progressFullUrl) : r.progressFullUrl;
        /** @type {string} */
        var css = "position: absolute; left: 50%; top: 50%; -webkit-transform: translate(-50%, -50%); transform: translate(-50%, -50%);";
        if (!options.logo) {
          /** @type {!Element} */
          options.logo = document.createElement("div");
          /** @type {string} */
          options.logo.style.cssText = css + "background: url('" + x + "') no-repeat center / contain; width: 154px; height: 130px;";
          options.container.appendChild(options.logo);
        }
        if (!options.progress) {
          /** @type {!Element} */
          options.progress = document.createElement("div");
          /** @type {string} */
          options.progress.style.cssText = css + " height: 18px; width: 141px; margin-top: 90px;";
          /** @type {!Element} */
          options.progress.empty = document.createElement("div");
          /** @type {string} */
          options.progress.empty.style.cssText = "background: url('" + o + "') no-repeat right / cover; float: right; width: 100%; height: 100%; display: inline-block;";
          options.progress.appendChild(options.progress.empty);
          /** @type {!Element} */
          options.progress.full = document.createElement("div");
          /** @type {string} */
          options.progress.full.style.cssText = "background: url('" + a + "') no-repeat left / cover; float: left; width: 0%; height: 100%; display: inline-block;";
          options.progress.appendChild(options.progress.full);
          options.container.appendChild(options.progress);
        }
        /** @type {string} */
        options.progress.full.style.width = 100 * data + "%";
        /** @type {string} */
        options.progress.empty.style.width = 100 * (1 - data) + "%";
        if (1 == data) {
          /** @type {string} */
          options.logo.style.display = options.progress.style.display = "none";
        }
      }
    },
    update : function(self, name, data) {
      var message = self.buildDownloadProgress[name];
      if (!message) {
        message = self.buildDownloadProgress[name] = {
          started : false,
          finished : false,
          lengthComputable : false,
          total : 0,
          loaded : 0
        };
      }
      if (!("object" != typeof data || "progress" != data.type && "load" != data.type)) {
        if (!message.started) {
          /** @type {boolean} */
          message.started = true;
          message.lengthComputable = data.lengthComputable;
          message.total = data.total;
        }
        message.loaded = data.loaded;
        if ("load" == data.type) {
          /** @type {boolean} */
          message.finished = true;
        }
      }
      /** @type {number} */
      var index = 0;
      /** @type {number} */
      var size = 0;
      /** @type {number} */
      var closeExpr = 0;
      /** @type {number} */
      var h = 0;
      /** @type {number} */
      var cday = 0;
      for (name in self.buildDownloadProgress) {
        message = self.buildDownloadProgress[name];
        if (!message.started) {
          return 0;
        }
        closeExpr++;
        if (message.lengthComputable) {
          index = index + message.loaded;
          size = size + message.total;
          h++;
        } else {
          if (!message.finished) {
            cday++;
          }
        }
      }
      /** @type {number} */
      var closingExpr = closeExpr ? (closeExpr - cday - (size ? h * (size - index) / size : 0)) / closeExpr : 0;
      self.gameInstance.onProgress(self.gameInstance, .9 * closingExpr);
    }
  },
  Compression : {
    identity : {
      require : function() {
        return {};
      },
      decompress : function(compressed) {
        return compressed;
      }
    },
    gzip : {
      require : function(callback) {
        var values = {
          "inflate.js" : function(require, module, exports) {
            /**
             * @param {number} options
             * @return {?}
             */
            function Inflate(options) {
              if (!(this instanceof Inflate)) {
                return new Inflate(options);
              }
              this.options = utils.assign({
                chunkSize : 16384,
                windowBits : 0,
                to : ""
              }, options || {});
              var opt = this.options;
              if (opt.raw && opt.windowBits >= 0 && opt.windowBits < 16) {
                /** @type {number} */
                opt.windowBits = -opt.windowBits;
                if (0 === opt.windowBits) {
                  /** @type {number} */
                  opt.windowBits = -15;
                }
              }
              if (!(!(opt.windowBits >= 0 && opt.windowBits < 16) || options && options.windowBits)) {
                opt.windowBits += 32;
              }
              if (opt.windowBits > 15 && opt.windowBits < 48 && 0 === (15 & opt.windowBits)) {
                opt.windowBits |= 15;
              }
              /** @type {number} */
              this.err = 0;
              /** @type {string} */
              this.msg = "";
              /** @type {boolean} */
              this.ended = false;
              /** @type {!Array} */
              this.chunks = [];
              this.strm = new ZStream;
              /** @type {number} */
              this.strm.avail_out = 0;
              var status = zlib_inflate.inflateInit2(this.strm, opt.windowBits);
              if (status !== c.Z_OK) {
                throw new Error(msg[status]);
              }
              this.header = new gzheader;
              zlib_inflate.inflateGetHeader(this.strm, this.header);
            }
            /**
             * @param {!Array} input
             * @param {!Object} options
             * @return {?}
             */
            function inflate(input, options) {
              var inflator = new Inflate(options);
              if (inflator.push(input, true), inflator.err) {
                throw inflator.msg || msg[inflator.err];
              }
              return inflator.result;
            }
            /**
             * @param {!Arguments} input
             * @param {!Object} options
             * @return {?}
             */
            function decode(input, options) {
              return options = options || {}, options.raw = true, inflate(input, options);
            }
            var zlib_inflate = require("./zlib/inflate");
            var utils = require("./utils/common");
            var strings = require("./utils/strings");
            var c = require("./zlib/constants");
            var msg = require("./zlib/messages");
            var ZStream = require("./zlib/zstream");
            var gzheader = require("./zlib/gzheader");
            /** @type {function(this:*): string} */
            var ts = Object.prototype.toString;
            /**
             * @param {!Object} data
             * @param {boolean} mode
             * @return {?}
             */
            Inflate.prototype.push = function(data, mode) {
              var status;
              var _mode;
              var next_out_utf8;
              var tail;
              var utf8str;
              var dict;
              var strm = this.strm;
              var chunkSize = this.options.chunkSize;
              var value = this.options.dictionary;
              /** @type {boolean} */
              var res = false;
              if (this.ended) {
                return false;
              }
              _mode = mode === ~~mode ? mode : mode === true ? c.Z_FINISH : c.Z_NO_FLUSH;
              if ("string" == typeof data) {
                strm.input = strings.binstring2buf(data);
              } else {
                if ("[object ArrayBuffer]" === ts.call(data)) {
                  /** @type {!Uint8Array} */
                  strm.input = new Uint8Array(data);
                } else {
                  /** @type {!Object} */
                  strm.input = data;
                }
              }
              /** @type {number} */
              strm.next_in = 0;
              strm.avail_in = strm.input.length;
              do {
                if (0 === strm.avail_out && (strm.output = new utils.Buf8(chunkSize), strm.next_out = 0, strm.avail_out = chunkSize), status = zlib_inflate.inflate(strm, c.Z_NO_FLUSH), status === c.Z_NEED_DICT && value && (dict = "string" == typeof value ? strings.string2buf(value) : "[object ArrayBuffer]" === ts.call(value) ? new Uint8Array(value) : value, status = zlib_inflate.inflateSetDictionary(this.strm, dict)), status === c.Z_BUF_ERROR && res === true && (status = c.Z_OK, res = false), status !== 
                c.Z_STREAM_END && status !== c.Z_OK) {
                  return this.onEnd(status), this.ended = true, false;
                }
                if (strm.next_out) {
                  if (!(0 !== strm.avail_out && status !== c.Z_STREAM_END && (0 !== strm.avail_in || _mode !== c.Z_FINISH && _mode !== c.Z_SYNC_FLUSH))) {
                    if ("string" === this.options.to) {
                      next_out_utf8 = strings.utf8border(strm.output, strm.next_out);
                      /** @type {number} */
                      tail = strm.next_out - next_out_utf8;
                      utf8str = strings.buf2string(strm.output, next_out_utf8);
                      /** @type {number} */
                      strm.next_out = tail;
                      /** @type {number} */
                      strm.avail_out = chunkSize - tail;
                      if (tail) {
                        utils.arraySet(strm.output, strm.output, next_out_utf8, tail, 0);
                      }
                      this.onData(utf8str);
                    } else {
                      this.onData(utils.shrinkBuf(strm.output, strm.next_out));
                    }
                  }
                }
                if (0 === strm.avail_in && 0 === strm.avail_out) {
                  /** @type {boolean} */
                  res = true;
                }
              } while ((strm.avail_in > 0 || 0 === strm.avail_out) && status !== c.Z_STREAM_END);
              return status === c.Z_STREAM_END && (_mode = c.Z_FINISH), _mode === c.Z_FINISH ? (status = zlib_inflate.inflateEnd(this.strm), this.onEnd(status), this.ended = true, status === c.Z_OK) : _mode !== c.Z_SYNC_FLUSH || (this.onEnd(c.Z_OK), strm.avail_out = 0, true);
            };
            /**
             * @param {!Object} chunk
             * @return {undefined}
             */
            Inflate.prototype.onData = function(chunk) {
              this.chunks.push(chunk);
            };
            /**
             * @param {!Object} status
             * @return {undefined}
             */
            Inflate.prototype.onEnd = function(status) {
              if (status === c.Z_OK) {
                if ("string" === this.options.to) {
                  this.result = this.chunks.join("");
                } else {
                  this.result = utils.flattenChunks(this.chunks);
                }
              }
              /** @type {!Array} */
              this.chunks = [];
              /** @type {!Object} */
              this.err = status;
              this.msg = this.strm.msg;
            };
            /** @type {function(number): ?} */
            exports.Inflate = Inflate;
            /** @type {function(!Array, !Object): ?} */
            exports.inflate = inflate;
            /** @type {function(!Arguments, !Object): ?} */
            exports.inflateRaw = decode;
            /** @type {function(!Array, !Object): ?} */
            exports.ungzip = inflate;
          },
          "utils/common.js" : function(someChunks, module, exports) {
            /** @type {boolean} */
            var TYPED_OK = "undefined" != typeof Uint8Array && "undefined" != typeof Uint16Array && "undefined" != typeof Int32Array;
            /**
             * @param {!Object} to
             * @return {?}
             */
            exports.assign = function(to) {
              /** @type {!Array<?>} */
              var keysToSend = Array.prototype.slice.call(arguments, 1);
              for (; keysToSend.length;) {
                var obj = keysToSend.shift();
                if (obj) {
                  if ("object" != typeof obj) {
                    throw new TypeError(obj + "must be non-object");
                  }
                  var key;
                  for (key in obj) {
                    if (obj.hasOwnProperty(key)) {
                      to[key] = obj[key];
                    }
                  }
                }
              }
              return to;
            };
            /**
             * @param {string} buffer
             * @param {number} length
             * @return {?}
             */
            exports.shrinkBuf = function(buffer, length) {
              return buffer.length === length ? buffer : buffer.subarray ? buffer.subarray(0, length) : (buffer.length = length, buffer);
            };
            var fnTyped = {
              arraySet : function(dest, src, src_offs, len, dest_offs) {
                if (src.subarray && dest.subarray) {
                  return void dest.set(src.subarray(src_offs, src_offs + len), dest_offs);
                }
                /** @type {number} */
                var i = 0;
                for (; i < len; i++) {
                  dest[dest_offs + i] = src[src_offs + i];
                }
              },
              flattenChunks : function(chunks) {
                var i;
                var l;
                var outputByteCount;
                var written;
                var chunk;
                var result;
                /** @type {number} */
                outputByteCount = 0;
                /** @type {number} */
                i = 0;
                l = chunks.length;
                for (; i < l; i++) {
                  outputByteCount = outputByteCount + chunks[i].length;
                }
                /** @type {!Uint8Array} */
                result = new Uint8Array(outputByteCount);
                /** @type {number} */
                written = 0;
                /** @type {number} */
                i = 0;
                l = chunks.length;
                for (; i < l; i++) {
                  chunk = chunks[i];
                  result.set(chunk, written);
                  written = written + chunk.length;
                }
                return result;
              }
            };
            var fnUntyped = {
              arraySet : function(dest, src, src_offs, len, dest_offs) {
                /** @type {number} */
                var i = 0;
                for (; i < len; i++) {
                  dest[dest_offs + i] = src[src_offs + i];
                }
              },
              flattenChunks : function(chunks) {
                return [].concat.apply([], chunks);
              }
            };
            /**
             * @param {boolean} on
             * @return {undefined}
             */
            exports.setTyped = function(on) {
              if (on) {
                /** @type {function(new:Uint8Array, (Array<number>|ArrayBuffer|ArrayBufferView|SharedArrayBuffer|null|number), number=, number=): ?} */
                exports.Buf8 = Uint8Array;
                /** @type {function(new:Uint16Array, (Array<number>|ArrayBuffer|ArrayBufferView|SharedArrayBuffer|null|number), number=, number=): ?} */
                exports.Buf16 = Uint16Array;
                /** @type {function(new:Int32Array, (Array<number>|ArrayBuffer|ArrayBufferView|SharedArrayBuffer|null|number), number=, number=): ?} */
                exports.Buf32 = Int32Array;
                exports.assign(exports, fnTyped);
              } else {
                /** @type {function(new:Array, ...*): !Array} */
                exports.Buf8 = Array;
                /** @type {function(new:Array, ...*): !Array} */
                exports.Buf16 = Array;
                /** @type {function(new:Array, ...*): !Array} */
                exports.Buf32 = Array;
                exports.assign(exports, fnUntyped);
              }
            };
            exports.setTyped(TYPED_OK);
          },
          "utils/strings.js" : function(require, module, exports) {
            /**
             * @param {string} buf
             * @param {number} len
             * @return {?}
             */
            function buf2binstring(buf, len) {
              if (len < 65537 && (buf.subarray && STR_APPLY_UIA_OK || !buf.subarray && STR_APPLY_OK)) {
                return String.fromCharCode.apply(null, utils.shrinkBuf(buf, len));
              }
              /** @type {string} */
              var result = "";
              /** @type {number} */
              var i = 0;
              for (; i < len; i++) {
                /** @type {string} */
                result = result + String.fromCharCode(buf[i]);
              }
              return result;
            }
            var utils = require("./common");
            /** @type {boolean} */
            var STR_APPLY_OK = true;
            /** @type {boolean} */
            var STR_APPLY_UIA_OK = true;
            try {
              String.fromCharCode.apply(null, [0]);
            } catch (e) {
              /** @type {boolean} */
              STR_APPLY_OK = false;
            }
            try {
              String.fromCharCode.apply(null, new Uint8Array(1));
            } catch (e) {
              /** @type {boolean} */
              STR_APPLY_UIA_OK = false;
            }
            var _utf8len = new utils.Buf8(256);
            /** @type {number} */
            var i = 0;
            for (; i < 256; i++) {
              /** @type {number} */
              _utf8len[i] = i >= 252 ? 6 : i >= 248 ? 5 : i >= 240 ? 4 : i >= 224 ? 3 : i >= 192 ? 2 : 1;
            }
            /** @type {number} */
            _utf8len[254] = _utf8len[254] = 1;
            /**
             * @param {string} str
             * @return {?}
             */
            exports.string2buf = function(str) {
              var buf;
              var A;
              var n;
              var a;
              var i;
              var c = str.length;
              /** @type {number} */
              var buf_len = 0;
              /** @type {number} */
              a = 0;
              for (; a < c; a++) {
                A = str.charCodeAt(a);
                if (55296 === (64512 & A) && a + 1 < c) {
                  n = str.charCodeAt(a + 1);
                  if (56320 === (64512 & n)) {
                    /** @type {number} */
                    A = 65536 + (A - 55296 << 10) + (n - 56320);
                    a++;
                  }
                }
                /** @type {number} */
                buf_len = buf_len + (A < 128 ? 1 : A < 2048 ? 2 : A < 65536 ? 3 : 4);
              }
              buf = new utils.Buf8(buf_len);
              /** @type {number} */
              i = 0;
              /** @type {number} */
              a = 0;
              for (; i < buf_len; a++) {
                A = str.charCodeAt(a);
                if (55296 === (64512 & A) && a + 1 < c) {
                  n = str.charCodeAt(a + 1);
                  if (56320 === (64512 & n)) {
                    /** @type {number} */
                    A = 65536 + (A - 55296 << 10) + (n - 56320);
                    a++;
                  }
                }
                if (A < 128) {
                  buf[i++] = A;
                } else {
                  if (A < 2048) {
                    /** @type {number} */
                    buf[i++] = 192 | A >>> 6;
                    /** @type {number} */
                    buf[i++] = 128 | 63 & A;
                  } else {
                    if (A < 65536) {
                      /** @type {number} */
                      buf[i++] = 224 | A >>> 12;
                      /** @type {number} */
                      buf[i++] = 128 | A >>> 6 & 63;
                      /** @type {number} */
                      buf[i++] = 128 | 63 & A;
                    } else {
                      /** @type {number} */
                      buf[i++] = 240 | A >>> 18;
                      /** @type {number} */
                      buf[i++] = 128 | A >>> 12 & 63;
                      /** @type {number} */
                      buf[i++] = 128 | A >>> 6 & 63;
                      /** @type {number} */
                      buf[i++] = 128 | 63 & A;
                    }
                  }
                }
              }
              return buf;
            };
            /**
             * @param {string} buf
             * @return {?}
             */
            exports.buf2binstring = function(buf) {
              return buf2binstring(buf, buf.length);
            };
            /**
             * @param {string} str
             * @return {?}
             */
            exports.binstring2buf = function(str) {
              var buf = new utils.Buf8(str.length);
              /** @type {number} */
              var i = 0;
              var l = buf.length;
              for (; i < l; i++) {
                buf[i] = str.charCodeAt(i);
              }
              return buf;
            };
            /**
             * @param {!Object} buf
             * @param {number} max
             * @return {?}
             */
            exports.buf2string = function(buf, max) {
              var i;
              var out;
              var c;
              var c_len;
              var len = max || buf.length;
              /** @type {!Array} */
              var utf16buf = new Array(2 * len);
              /** @type {number} */
              out = 0;
              /** @type {number} */
              i = 0;
              for (; i < len;) {
                if (c = buf[i++], c < 128) {
                  utf16buf[out++] = c;
                } else {
                  if (c_len = _utf8len[c], c_len > 4) {
                    /** @type {number} */
                    utf16buf[out++] = 65533;
                    /** @type {number} */
                    i = i + (c_len - 1);
                  } else {
                    /** @type {number} */
                    c = c & (2 === c_len ? 31 : 3 === c_len ? 15 : 7);
                    for (; c_len > 1 && i < len;) {
                      /** @type {number} */
                      c = c << 6 | 63 & buf[i++];
                      c_len--;
                    }
                    if (c_len > 1) {
                      /** @type {number} */
                      utf16buf[out++] = 65533;
                    } else {
                      if (c < 65536) {
                        utf16buf[out++] = c;
                      } else {
                        /** @type {number} */
                        c = c - 65536;
                        /** @type {number} */
                        utf16buf[out++] = 55296 | c >> 10 & 1023;
                        /** @type {number} */
                        utf16buf[out++] = 56320 | 1023 & c;
                      }
                    }
                  }
                }
              }
              return buf2binstring(utf16buf, out);
            };
            /**
             * @param {!Array} buf
             * @param {number} max
             * @return {?}
             */
            exports.utf8border = function(buf, max) {
              var pos;
              max = max || buf.length;
              if (max > buf.length) {
                max = buf.length;
              }
              /** @type {number} */
              pos = max - 1;
              for (; pos >= 0 && 128 === (192 & buf[pos]);) {
                pos--;
              }
              return pos < 0 ? max : 0 === pos ? max : pos + _utf8len[buf[pos]] > max ? pos : max;
            };
          },
          "zlib/inflate.js" : function(require, module, exports) {
            /**
             * @param {number} q
             * @return {?}
             */
            function ZSWAP32(q) {
              return (q >>> 24 & 255) + (q >>> 8 & 65280) + ((65280 & q) << 8) + ((255 & q) << 24);
            }
            /**
             * @return {undefined}
             */
            function InflateState() {
              /** @type {number} */
              this.mode = 0;
              /** @type {boolean} */
              this.last = false;
              /** @type {number} */
              this.wrap = 0;
              /** @type {boolean} */
              this.havedict = false;
              /** @type {number} */
              this.flags = 0;
              /** @type {number} */
              this.dmax = 0;
              /** @type {number} */
              this.check = 0;
              /** @type {number} */
              this.total = 0;
              /** @type {null} */
              this.head = null;
              /** @type {number} */
              this.wbits = 0;
              /** @type {number} */
              this.wsize = 0;
              /** @type {number} */
              this.whave = 0;
              /** @type {number} */
              this.wnext = 0;
              /** @type {null} */
              this.window = null;
              /** @type {number} */
              this.hold = 0;
              /** @type {number} */
              this.bits = 0;
              /** @type {number} */
              this.length = 0;
              /** @type {number} */
              this.offset = 0;
              /** @type {number} */
              this.extra = 0;
              /** @type {null} */
              this.lencode = null;
              /** @type {null} */
              this.distcode = null;
              /** @type {number} */
              this.lenbits = 0;
              /** @type {number} */
              this.distbits = 0;
              /** @type {number} */
              this.ncode = 0;
              /** @type {number} */
              this.nlen = 0;
              /** @type {number} */
              this.ndist = 0;
              /** @type {number} */
              this.have = 0;
              /** @type {null} */
              this.next = null;
              this.lens = new utils.Buf16(320);
              this.work = new utils.Buf16(288);
              /** @type {null} */
              this.lendyn = null;
              /** @type {null} */
              this.distdyn = null;
              /** @type {number} */
              this.sane = 0;
              /** @type {number} */
              this.back = 0;
              /** @type {number} */
              this.was = 0;
            }
            /**
             * @param {!Object} strm
             * @return {?}
             */
            function inflateResetKeep(strm) {
              var state;
              return strm && strm.state ? (state = strm.state, strm.total_in = strm.total_out = state.total = 0, strm.msg = "", state.wrap && (strm.adler = 1 & state.wrap), state.mode = HEAD, state.last = 0, state.havedict = 0, state.dmax = 32768, state.head = null, state.hold = 0, state.bits = 0, state.lencode = state.lendyn = new utils.Buf32(ENOUGH_LENS), state.distcode = state.distdyn = new utils.Buf32(ENOUGH_DISTS), state.sane = 1, state.back = -1, undefined) : Z_STREAM_ERROR;
            }
            /**
             * @param {!Object} strm
             * @return {?}
             */
            function inflateReset(strm) {
              var state;
              return strm && strm.state ? (state = strm.state, state.wsize = 0, state.whave = 0, state.wnext = 0, inflateResetKeep(strm)) : Z_STREAM_ERROR;
            }
            /**
             * @param {!Object} strm
             * @param {string} windowBits
             * @return {?}
             */
            function inflateReset2(strm, windowBits) {
              var wrap;
              var state;
              return strm && strm.state ? (state = strm.state, windowBits < 0 ? (wrap = 0, windowBits = -windowBits) : (wrap = (windowBits >> 4) + 1, windowBits < 48 && (windowBits = windowBits & 15)), windowBits && (windowBits < 8 || windowBits > 15) ? Z_STREAM_ERROR : (null !== state.window && state.wbits !== windowBits && (state.window = null), state.wrap = wrap, state.wbits = windowBits, inflateReset(strm))) : Z_STREAM_ERROR;
            }
            /**
             * @param {string} strm
             * @param {!Function} windowBits
             * @return {?}
             */
            function inflateInit2(strm, windowBits) {
              var ret;
              var state;
              return strm ? (state = new InflateState, strm.state = state, state.window = null, ret = inflateReset2(strm, windowBits), ret !== undefined && (strm.state = null), ret) : Z_STREAM_ERROR;
            }
            /**
             * @param {string} strm
             * @return {?}
             */
            function inflateInit(strm) {
              return inflateInit2(strm, DEF_WBITS);
            }
            /**
             * @param {!Object} state
             * @return {undefined}
             */
            function fixedtables(state) {
              if (ge) {
                var sym;
                lenfix = new utils.Buf32(512);
                distfix = new utils.Buf32(32);
                /** @type {number} */
                sym = 0;
                for (; sym < 144;) {
                  /** @type {number} */
                  state.lens[sym++] = 8;
                }
                for (; sym < 256;) {
                  /** @type {number} */
                  state.lens[sym++] = 9;
                }
                for (; sym < 280;) {
                  /** @type {number} */
                  state.lens[sym++] = 7;
                }
                for (; sym < 288;) {
                  /** @type {number} */
                  state.lens[sym++] = 8;
                }
                inflate_table(LENS, state.lens, 0, 288, lenfix, 0, state.work, {
                  bits : 9
                });
                /** @type {number} */
                sym = 0;
                for (; sym < 32;) {
                  /** @type {number} */
                  state.lens[sym++] = 5;
                }
                inflate_table(DISTS, state.lens, 0, 32, distfix, 0, state.work, {
                  bits : 5
                });
                /** @type {boolean} */
                ge = false;
              }
              state.lencode = lenfix;
              /** @type {number} */
              state.lenbits = 9;
              state.distcode = distfix;
              /** @type {number} */
              state.distbits = 5;
            }
            /**
             * @param {!Object} strm
             * @param {!Object} src
             * @param {string} end
             * @param {number} copy
             * @return {?}
             */
            function updatewindow(strm, src, end, copy) {
              var dist;
              var state = strm.state;
              return null === state.window && (state.wsize = 1 << state.wbits, state.wnext = 0, state.whave = 0, state.window = new utils.Buf8(state.wsize)), copy >= state.wsize ? (utils.arraySet(state.window, src, end - state.wsize, state.wsize, 0), state.wnext = 0, state.whave = state.wsize) : (dist = state.wsize - state.wnext, dist > copy && (dist = copy), utils.arraySet(state.window, src, end - copy, dist, state.wnext), copy = copy - dist, copy ? (utils.arraySet(state.window, src, end - copy, 
              copy, 0), state.wnext = copy, state.whave = state.wsize) : (state.wnext += dist, state.wnext === state.wsize && (state.wnext = 0), state.whave < state.wsize && (state.whave += dist))), 0;
            }
            /**
             * @param {!Object} strm
             * @param {number} flush
             * @return {?}
             */
            function inflate(strm, flush) {
              var state;
              var input;
              var output;
              var next;
              var put;
              var have;
              var left;
              var hold;
              var bits;
              var _in;
              var _out;
              var copy;
              var from;
              var from_source;
              var here_bits;
              var right;
              var here_val;
              var last_bits;
              var last_op;
              var last_val;
              var len;
              var ret;
              var opts;
              var n;
              /** @type {number} */
              var here = 0;
              var hbuf = new utils.Buf8(4);
              /** @type {!Array} */
              var order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
              if (!strm || !strm.state || !strm.output || !strm.input && 0 !== strm.avail_in) {
                return Z_STREAM_ERROR;
              }
              state = strm.state;
              if (state.mode === TYPE) {
                /** @type {number} */
                state.mode = TYPEDO;
              }
              put = strm.next_out;
              output = strm.output;
              left = strm.avail_out;
              next = strm.next_in;
              input = strm.input;
              have = strm.avail_in;
              hold = state.hold;
              bits = state.bits;
              _in = have;
              _out = left;
              /** @type {number} */
              ret = undefined;
              e: for (;;) {
                switch(state.mode) {
                  case HEAD:
                    if (0 === state.wrap) {
                      state.mode = TYPEDO;
                      break;
                    }
                    for (; bits < 16;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (2 & state.wrap && 35615 === hold) {
                      /** @type {number} */
                      state.check = 0;
                      /** @type {number} */
                      hbuf[0] = 255 & hold;
                      /** @type {number} */
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                      /** @type {number} */
                      hold = 0;
                      /** @type {number} */
                      bits = 0;
                      state.mode = FLAGS;
                      break;
                    }
                    if (state.flags = 0, state.head && (state.head.done = false), !(1 & state.wrap) || (((255 & hold) << 8) + (hold >> 8)) % 31) {
                      /** @type {string} */
                      strm.msg = "incorrect header check";
                      state.mode = BAD;
                      break;
                    }
                    if ((15 & hold) !== T) {
                      /** @type {string} */
                      strm.msg = "unknown compression method";
                      state.mode = BAD;
                      break;
                    }
                    if (hold = hold >>> 4, bits = bits - 4, len = (15 & hold) + 8, 0 === state.wbits) {
                      /** @type {number} */
                      state.wbits = len;
                    } else {
                      if (len > state.wbits) {
                        /** @type {string} */
                        strm.msg = "invalid window size";
                        state.mode = BAD;
                        break;
                      }
                    }
                    /** @type {number} */
                    state.dmax = 1 << len;
                    /** @type {number} */
                    strm.adler = state.check = 1;
                    state.mode = 512 & hold ? DICTID : TYPE;
                    /** @type {number} */
                    hold = 0;
                    /** @type {number} */
                    bits = 0;
                    break;
                  case FLAGS:
                    for (; bits < 16;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (state.flags = hold, (255 & state.flags) !== T) {
                      /** @type {string} */
                      strm.msg = "unknown compression method";
                      state.mode = BAD;
                      break;
                    }
                    if (57344 & state.flags) {
                      /** @type {string} */
                      strm.msg = "unknown header flags set";
                      state.mode = BAD;
                      break;
                    }
                    if (state.head) {
                      /** @type {number} */
                      state.head.text = hold >> 8 & 1;
                    }
                    if (512 & state.flags) {
                      /** @type {number} */
                      hbuf[0] = 255 & hold;
                      /** @type {number} */
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                    }
                    /** @type {number} */
                    hold = 0;
                    /** @type {number} */
                    bits = 0;
                    state.mode = TIME;
                  case TIME:
                    for (; bits < 32;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (state.head) {
                      state.head.time = hold;
                    }
                    if (512 & state.flags) {
                      /** @type {number} */
                      hbuf[0] = 255 & hold;
                      /** @type {number} */
                      hbuf[1] = hold >>> 8 & 255;
                      /** @type {number} */
                      hbuf[2] = hold >>> 16 & 255;
                      /** @type {number} */
                      hbuf[3] = hold >>> 24 & 255;
                      state.check = crc32(state.check, hbuf, 4, 0);
                    }
                    /** @type {number} */
                    hold = 0;
                    /** @type {number} */
                    bits = 0;
                    state.mode = OS;
                  case OS:
                    for (; bits < 16;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (state.head) {
                      /** @type {number} */
                      state.head.xflags = 255 & hold;
                      /** @type {number} */
                      state.head.os = hold >> 8;
                    }
                    if (512 & state.flags) {
                      /** @type {number} */
                      hbuf[0] = 255 & hold;
                      /** @type {number} */
                      hbuf[1] = hold >>> 8 & 255;
                      state.check = crc32(state.check, hbuf, 2, 0);
                    }
                    /** @type {number} */
                    hold = 0;
                    /** @type {number} */
                    bits = 0;
                    state.mode = EXLEN;
                  case EXLEN:
                    if (1024 & state.flags) {
                      for (; bits < 16;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      state.length = hold;
                      if (state.head) {
                        state.head.extra_len = hold;
                      }
                      if (512 & state.flags) {
                        /** @type {number} */
                        hbuf[0] = 255 & hold;
                        /** @type {number} */
                        hbuf[1] = hold >>> 8 & 255;
                        state.check = crc32(state.check, hbuf, 2, 0);
                      }
                      /** @type {number} */
                      hold = 0;
                      /** @type {number} */
                      bits = 0;
                    } else {
                      if (state.head) {
                        /** @type {null} */
                        state.head.extra = null;
                      }
                    }
                    state.mode = EXTRA;
                  case EXTRA:
                    if (1024 & state.flags && (copy = state.length, copy > have && (copy = have), copy && (state.head && (len = state.head.extra_len - state.length, state.head.extra || (state.head.extra = new Array(state.head.extra_len)), utils.arraySet(state.head.extra, input, next, copy, len)), 512 & state.flags && (state.check = crc32(state.check, input, copy, next)), have = have - copy, next = next + copy, state.length -= copy), state.length)) {
                      break e;
                    }
                    /** @type {number} */
                    state.length = 0;
                    state.mode = NAME;
                  case NAME:
                    if (2048 & state.flags) {
                      if (0 === have) {
                        break e;
                      }
                      /** @type {number} */
                      copy = 0;
                      do {
                        len = input[next + copy++];
                        if (state.head && len && state.length < 65536) {
                          state.head.name += String.fromCharCode(len);
                        }
                      } while (len && copy < have);
                      if (512 & state.flags && (state.check = crc32(state.check, input, copy, next)), have = have - copy, next = next + copy, len) {
                        break e;
                      }
                    } else {
                      if (state.head) {
                        /** @type {null} */
                        state.head.name = null;
                      }
                    }
                    /** @type {number} */
                    state.length = 0;
                    state.mode = COMMENT;
                  case COMMENT:
                    if (4096 & state.flags) {
                      if (0 === have) {
                        break e;
                      }
                      /** @type {number} */
                      copy = 0;
                      do {
                        len = input[next + copy++];
                        if (state.head && len && state.length < 65536) {
                          state.head.comment += String.fromCharCode(len);
                        }
                      } while (len && copy < have);
                      if (512 & state.flags && (state.check = crc32(state.check, input, copy, next)), have = have - copy, next = next + copy, len) {
                        break e;
                      }
                    } else {
                      if (state.head) {
                        /** @type {null} */
                        state.head.comment = null;
                      }
                    }
                    state.mode = HCRC;
                  case HCRC:
                    if (512 & state.flags) {
                      for (; bits < 16;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      if (hold !== (65535 & state.check)) {
                        /** @type {string} */
                        strm.msg = "header crc mismatch";
                        state.mode = BAD;
                        break;
                      }
                      /** @type {number} */
                      hold = 0;
                      /** @type {number} */
                      bits = 0;
                    }
                    if (state.head) {
                      /** @type {number} */
                      state.head.hcrc = state.flags >> 9 & 1;
                      /** @type {boolean} */
                      state.head.done = true;
                    }
                    /** @type {number} */
                    strm.adler = state.check = 0;
                    state.mode = TYPE;
                    break;
                  case DICTID:
                    for (; bits < 32;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    strm.adler = state.check = ZSWAP32(hold);
                    /** @type {number} */
                    hold = 0;
                    /** @type {number} */
                    bits = 0;
                    state.mode = DICT;
                  case DICT:
                    if (0 === state.havedict) {
                      return strm.next_out = put, strm.avail_out = left, strm.next_in = next, strm.avail_in = have, state.hold = hold, state.bits = bits, N;
                    }
                    /** @type {number} */
                    strm.adler = state.check = 1;
                    state.mode = TYPE;
                  case TYPE:
                    if (flush === Z_BLOCK || flush === Z_TREES) {
                      break e;
                    }
                  case TYPEDO:
                    if (state.last) {
                      /** @type {number} */
                      hold = hold >>> (7 & bits);
                      /** @type {number} */
                      bits = bits - (7 & bits);
                      state.mode = CHECK;
                      break;
                    }
                    for (; bits < 3;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    switch(state.last = 1 & hold, hold = hold >>> 1, bits = bits - 1, 3 & hold) {
                      case 0:
                        state.mode = STORED;
                        break;
                      case 1:
                        if (fixedtables(state), state.mode = LEN_, flush === Z_TREES) {
                          /** @type {number} */
                          hold = hold >>> 2;
                          /** @type {number} */
                          bits = bits - 2;
                          break e;
                        }
                        break;
                      case 2:
                        state.mode = TABLE;
                        break;
                      case 3:
                        /** @type {string} */
                        strm.msg = "invalid block type";
                        state.mode = BAD;
                    }/** @type {number} */
                    hold = hold >>> 2;
                    /** @type {number} */
                    bits = bits - 2;
                    break;
                  case STORED:
                    /** @type {number} */
                    hold = hold >>> (7 & bits);
                    /** @type {number} */
                    bits = bits - (7 & bits);
                    for (; bits < 32;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if ((65535 & hold) !== (hold >>> 16 ^ 65535)) {
                      /** @type {string} */
                      strm.msg = "invalid stored block lengths";
                      state.mode = BAD;
                      break;
                    }
                    if (state.length = 65535 & hold, hold = 0, bits = 0, state.mode = COPY_, flush === Z_TREES) {
                      break e;
                    }
                  case COPY_:
                    state.mode = COPY;
                  case COPY:
                    if (copy = state.length) {
                      if (copy > have && (copy = have), copy > left && (copy = left), 0 === copy) {
                        break e;
                      }
                      utils.arraySet(output, input, next, copy, put);
                      /** @type {number} */
                      have = have - copy;
                      next = next + copy;
                      /** @type {number} */
                      left = left - copy;
                      put = put + copy;
                      state.length -= copy;
                      break;
                    }
                    state.mode = TYPE;
                    break;
                  case TABLE:
                    for (; bits < 14;) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (state.nlen = (31 & hold) + 257, hold = hold >>> 5, bits = bits - 5, state.ndist = (31 & hold) + 1, hold = hold >>> 5, bits = bits - 5, state.ncode = (15 & hold) + 4, hold = hold >>> 4, bits = bits - 4, state.nlen > 286 || state.ndist > 30) {
                      /** @type {string} */
                      strm.msg = "too many length or distance symbols";
                      state.mode = BAD;
                      break;
                    }
                    /** @type {number} */
                    state.have = 0;
                    state.mode = LENLENS;
                  case LENLENS:
                    for (; state.have < state.ncode;) {
                      for (; bits < 3;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      /** @type {number} */
                      state.lens[order[state.have++]] = 7 & hold;
                      /** @type {number} */
                      hold = hold >>> 3;
                      /** @type {number} */
                      bits = bits - 3;
                    }
                    for (; state.have < 19;) {
                      /** @type {number} */
                      state.lens[order[state.have++]] = 0;
                    }
                    if (state.lencode = state.lendyn, state.lenbits = 7, opts = {
                      bits : state.lenbits
                    }, ret = inflate_table(CODES, state.lens, 0, 19, state.lencode, 0, state.work, opts), state.lenbits = opts.bits, ret) {
                      /** @type {string} */
                      strm.msg = "invalid code lengths set";
                      state.mode = BAD;
                      break;
                    }
                    /** @type {number} */
                    state.have = 0;
                    state.mode = CODELENS;
                  case CODELENS:
                    for (; state.have < state.nlen + state.ndist;) {
                      for (; here = state.lencode[hold & (1 << state.lenbits) - 1], here_bits = here >>> 24, right = here >>> 16 & 255, here_val = 65535 & here, !(here_bits <= bits);) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      if (here_val < 16) {
                        /** @type {number} */
                        hold = hold >>> here_bits;
                        /** @type {number} */
                        bits = bits - here_bits;
                        /** @type {number} */
                        state.lens[state.have++] = here_val;
                      } else {
                        if (16 === here_val) {
                          /** @type {number} */
                          n = here_bits + 2;
                          for (; bits < n;) {
                            if (0 === have) {
                              break e;
                            }
                            have--;
                            hold = hold + (input[next++] << bits);
                            bits = bits + 8;
                          }
                          if (hold = hold >>> here_bits, bits = bits - here_bits, 0 === state.have) {
                            /** @type {string} */
                            strm.msg = "invalid bit length repeat";
                            state.mode = BAD;
                            break;
                          }
                          len = state.lens[state.have - 1];
                          /** @type {number} */
                          copy = 3 + (3 & hold);
                          /** @type {number} */
                          hold = hold >>> 2;
                          /** @type {number} */
                          bits = bits - 2;
                        } else {
                          if (17 === here_val) {
                            /** @type {number} */
                            n = here_bits + 3;
                            for (; bits < n;) {
                              if (0 === have) {
                                break e;
                              }
                              have--;
                              hold = hold + (input[next++] << bits);
                              bits = bits + 8;
                            }
                            /** @type {number} */
                            hold = hold >>> here_bits;
                            /** @type {number} */
                            bits = bits - here_bits;
                            /** @type {number} */
                            len = 0;
                            /** @type {number} */
                            copy = 3 + (7 & hold);
                            /** @type {number} */
                            hold = hold >>> 3;
                            /** @type {number} */
                            bits = bits - 3;
                          } else {
                            /** @type {number} */
                            n = here_bits + 7;
                            for (; bits < n;) {
                              if (0 === have) {
                                break e;
                              }
                              have--;
                              hold = hold + (input[next++] << bits);
                              bits = bits + 8;
                            }
                            /** @type {number} */
                            hold = hold >>> here_bits;
                            /** @type {number} */
                            bits = bits - here_bits;
                            /** @type {number} */
                            len = 0;
                            /** @type {number} */
                            copy = 11 + (127 & hold);
                            /** @type {number} */
                            hold = hold >>> 7;
                            /** @type {number} */
                            bits = bits - 7;
                          }
                        }
                        if (state.have + copy > state.nlen + state.ndist) {
                          /** @type {string} */
                          strm.msg = "invalid bit length repeat";
                          state.mode = BAD;
                          break;
                        }
                        for (; copy--;) {
                          state.lens[state.have++] = len;
                        }
                      }
                    }
                    if (state.mode === BAD) {
                      break;
                    }
                    if (0 === state.lens[256]) {
                      /** @type {string} */
                      strm.msg = "invalid code -- missing end-of-block";
                      state.mode = BAD;
                      break;
                    }
                    if (state.lenbits = 9, opts = {
                      bits : state.lenbits
                    }, ret = inflate_table(LENS, state.lens, 0, state.nlen, state.lencode, 0, state.work, opts), state.lenbits = opts.bits, ret) {
                      /** @type {string} */
                      strm.msg = "invalid literal/lengths set";
                      state.mode = BAD;
                      break;
                    }
                    if (state.distbits = 6, state.distcode = state.distdyn, opts = {
                      bits : state.distbits
                    }, ret = inflate_table(DISTS, state.lens, state.nlen, state.ndist, state.distcode, 0, state.work, opts), state.distbits = opts.bits, ret) {
                      /** @type {string} */
                      strm.msg = "invalid distances set";
                      state.mode = BAD;
                      break;
                    }
                    if (state.mode = LEN_, flush === Z_TREES) {
                      break e;
                    }
                  case LEN_:
                    state.mode = LEN;
                  case LEN:
                    if (have >= 6 && left >= 258) {
                      strm.next_out = put;
                      strm.avail_out = left;
                      strm.next_in = next;
                      strm.avail_in = have;
                      state.hold = hold;
                      state.bits = bits;
                      inflate_fast(strm, _out);
                      put = strm.next_out;
                      output = strm.output;
                      left = strm.avail_out;
                      next = strm.next_in;
                      input = strm.input;
                      have = strm.avail_in;
                      hold = state.hold;
                      bits = state.bits;
                      if (state.mode === TYPE) {
                        /** @type {number} */
                        state.back = -1;
                      }
                      break;
                    }
                    /** @type {number} */
                    state.back = 0;
                    for (; here = state.lencode[hold & (1 << state.lenbits) - 1], here_bits = here >>> 24, right = here >>> 16 & 255, here_val = 65535 & here, !(here_bits <= bits);) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (right && 0 === (240 & right)) {
                      /** @type {number} */
                      last_bits = here_bits;
                      /** @type {number} */
                      last_op = right;
                      /** @type {number} */
                      last_val = here_val;
                      for (; here = state.lencode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)], here_bits = here >>> 24, right = here >>> 16 & 255, here_val = 65535 & here, !(last_bits + here_bits <= bits);) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      /** @type {number} */
                      hold = hold >>> last_bits;
                      /** @type {number} */
                      bits = bits - last_bits;
                      state.back += last_bits;
                    }
                    if (hold = hold >>> here_bits, bits = bits - here_bits, state.back += here_bits, state.length = here_val, 0 === right) {
                      state.mode = LIT;
                      break;
                    }
                    if (32 & right) {
                      /** @type {number} */
                      state.back = -1;
                      state.mode = TYPE;
                      break;
                    }
                    if (64 & right) {
                      /** @type {string} */
                      strm.msg = "invalid literal/length code";
                      state.mode = BAD;
                      break;
                    }
                    /** @type {number} */
                    state.extra = 15 & right;
                    state.mode = LENEXT;
                  case LENEXT:
                    if (state.extra) {
                      n = state.extra;
                      for (; bits < n;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      state.length += hold & (1 << state.extra) - 1;
                      /** @type {number} */
                      hold = hold >>> state.extra;
                      /** @type {number} */
                      bits = bits - state.extra;
                      state.back += state.extra;
                    }
                    state.was = state.length;
                    state.mode = DIST;
                  case DIST:
                    for (; here = state.distcode[hold & (1 << state.distbits) - 1], here_bits = here >>> 24, right = here >>> 16 & 255, here_val = 65535 & here, !(here_bits <= bits);) {
                      if (0 === have) {
                        break e;
                      }
                      have--;
                      hold = hold + (input[next++] << bits);
                      bits = bits + 8;
                    }
                    if (0 === (240 & right)) {
                      /** @type {number} */
                      last_bits = here_bits;
                      /** @type {number} */
                      last_op = right;
                      /** @type {number} */
                      last_val = here_val;
                      for (; here = state.distcode[last_val + ((hold & (1 << last_bits + last_op) - 1) >> last_bits)], here_bits = here >>> 24, right = here >>> 16 & 255, here_val = 65535 & here, !(last_bits + here_bits <= bits);) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      /** @type {number} */
                      hold = hold >>> last_bits;
                      /** @type {number} */
                      bits = bits - last_bits;
                      state.back += last_bits;
                    }
                    if (hold = hold >>> here_bits, bits = bits - here_bits, state.back += here_bits, 64 & right) {
                      /** @type {string} */
                      strm.msg = "invalid distance code";
                      state.mode = BAD;
                      break;
                    }
                    /** @type {number} */
                    state.offset = here_val;
                    /** @type {number} */
                    state.extra = 15 & right;
                    state.mode = DISTEXT;
                  case DISTEXT:
                    if (state.extra) {
                      n = state.extra;
                      for (; bits < n;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      state.offset += hold & (1 << state.extra) - 1;
                      /** @type {number} */
                      hold = hold >>> state.extra;
                      /** @type {number} */
                      bits = bits - state.extra;
                      state.back += state.extra;
                    }
                    if (state.offset > state.dmax) {
                      /** @type {string} */
                      strm.msg = "invalid distance too far back";
                      state.mode = BAD;
                      break;
                    }
                    state.mode = MATCH;
                  case MATCH:
                    if (0 === left) {
                      break e;
                    }
                    if (copy = _out - left, state.offset > copy) {
                      if (copy = state.offset - copy, copy > state.whave && state.sane) {
                        /** @type {string} */
                        strm.msg = "invalid distance too far back";
                        state.mode = BAD;
                        break;
                      }
                      if (copy > state.wnext) {
                        /** @type {number} */
                        copy = copy - state.wnext;
                        /** @type {number} */
                        from = state.wsize - copy;
                      } else {
                        /** @type {number} */
                        from = state.wnext - copy;
                      }
                      if (copy > state.length) {
                        copy = state.length;
                      }
                      from_source = state.window;
                    } else {
                      from_source = output;
                      /** @type {number} */
                      from = put - state.offset;
                      copy = state.length;
                    }
                    if (copy > left) {
                      copy = left;
                    }
                    /** @type {number} */
                    left = left - copy;
                    state.length -= copy;
                    do {
                      output[put++] = from_source[from++];
                    } while (--copy);
                    if (0 === state.length) {
                      state.mode = LEN;
                    }
                    break;
                  case LIT:
                    if (0 === left) {
                      break e;
                    }
                    output[put++] = state.length;
                    left--;
                    state.mode = LEN;
                    break;
                  case CHECK:
                    if (state.wrap) {
                      for (; bits < 32;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        /** @type {number} */
                        hold = hold | input[next++] << bits;
                        bits = bits + 8;
                      }
                      if (_out = _out - left, strm.total_out += _out, state.total += _out, _out && (strm.adler = state.check = state.flags ? crc32(state.check, output, _out, put - _out) : adler32(state.check, output, _out, put - _out)), _out = left, (state.flags ? hold : ZSWAP32(hold)) !== state.check) {
                        /** @type {string} */
                        strm.msg = "incorrect data check";
                        state.mode = BAD;
                        break;
                      }
                      /** @type {number} */
                      hold = 0;
                      /** @type {number} */
                      bits = 0;
                    }
                    state.mode = LENGTH;
                  case LENGTH:
                    if (state.wrap && state.flags) {
                      for (; bits < 32;) {
                        if (0 === have) {
                          break e;
                        }
                        have--;
                        hold = hold + (input[next++] << bits);
                        bits = bits + 8;
                      }
                      if (hold !== (4294967295 & state.total)) {
                        /** @type {string} */
                        strm.msg = "incorrect length check";
                        state.mode = BAD;
                        break;
                      }
                      /** @type {number} */
                      hold = 0;
                      /** @type {number} */
                      bits = 0;
                    }
                    /** @type {number} */
                    state.mode = DONE;
                  case DONE:
                    /** @type {number} */
                    ret = TorrenTopia;
                    break e;
                  case BAD:
                    /** @type {number} */
                    ret = canUrl;
                    break e;
                  case MEM:
                    return ranges;
                  case SYNC:
                  default:
                    return Z_STREAM_ERROR;
                }
              }
              return strm.next_out = put, strm.avail_out = left, strm.next_in = next, strm.avail_in = have, state.hold = hold, state.bits = bits, (state.wsize || _out !== strm.avail_out && state.mode < BAD && (state.mode < CHECK || flush !== Z_FINISH)) && updatewindow(strm, strm.output, strm.next_out, _out - strm.avail_out) ? (state.mode = MEM, ranges) : (_in = _in - strm.avail_in, _out = _out - strm.avail_out, strm.total_in += _in, strm.total_out += _out, state.total += _out, state.wrap && _out && 
              (strm.adler = state.check = state.flags ? crc32(state.check, output, _out, strm.next_out - _out) : adler32(state.check, output, _out, strm.next_out - _out)), strm.data_type = state.bits + (state.last ? 64 : 0) + (state.mode === TYPE ? 128 : 0) + (state.mode === LEN_ || state.mode === COPY_ ? 256 : 0), (0 === _in && 0 === _out || flush === Z_FINISH) && ret === undefined && (ret = enable_move_colors), ret);
            }
            /**
             * @param {!Event} strm
             * @return {?}
             */
            function inflateEnd(strm) {
              if (!strm || !strm.state) {
                return Z_STREAM_ERROR;
              }
              var s = strm.state;
              return s.window && (s.window = null), strm.state = null, undefined;
            }
            /**
             * @param {!Object} response
             * @param {string} head
             * @return {?}
             */
            function inflateGetHeader(response, head) {
              var _ref;
              return response && response.state ? (_ref = response.state, 0 === (2 & _ref.wrap) ? Z_STREAM_ERROR : (_ref.head = head, head.done = false, undefined)) : Z_STREAM_ERROR;
            }
            /**
             * @param {!Object} strm
             * @param {!Object} dictionary
             * @return {?}
             */
            function inflateSetDictionary(strm, dictionary) {
              var state;
              var dictid;
              var ret;
              var dictLength = dictionary.length;
              return strm && strm.state ? (state = strm.state, 0 !== state.wrap && state.mode !== DICT ? Z_STREAM_ERROR : state.mode === DICT && (dictid = 1, dictid = adler32(dictid, dictionary, dictLength, 0), dictid !== state.check) ? canUrl : (ret = updatewindow(strm, dictionary, dictLength, dictLength)) ? (state.mode = MEM, ranges) : (state.havedict = 1, undefined)) : Z_STREAM_ERROR;
            }
            var lenfix;
            var distfix;
            var utils = require("../utils/common");
            var adler32 = require("./adler32");
            var crc32 = require("./crc32");
            var inflate_fast = require("./inffast");
            var inflate_table = require("./inftrees");
            /** @type {number} */
            var CODES = 0;
            /** @type {number} */
            var LENS = 1;
            /** @type {number} */
            var DISTS = 2;
            /** @type {number} */
            var Z_FINISH = 4;
            /** @type {number} */
            var Z_BLOCK = 5;
            /** @type {number} */
            var Z_TREES = 6;
            /** @type {number} */
            var undefined = 0;
            /** @type {number} */
            var TorrenTopia = 1;
            /** @type {number} */
            var N = 2;
            /** @type {number} */
            var Z_STREAM_ERROR = -2;
            /** @type {number} */
            var canUrl = -3;
            /** @type {number} */
            var ranges = -4;
            /** @type {number} */
            var enable_move_colors = -5;
            /** @type {number} */
            var T = 8;
            /** @type {number} */
            var HEAD = 1;
            /** @type {number} */
            var FLAGS = 2;
            /** @type {number} */
            var TIME = 3;
            /** @type {number} */
            var OS = 4;
            /** @type {number} */
            var EXLEN = 5;
            /** @type {number} */
            var EXTRA = 6;
            /** @type {number} */
            var NAME = 7;
            /** @type {number} */
            var COMMENT = 8;
            /** @type {number} */
            var HCRC = 9;
            /** @type {number} */
            var DICTID = 10;
            /** @type {number} */
            var DICT = 11;
            /** @type {number} */
            var TYPE = 12;
            /** @type {number} */
            var TYPEDO = 13;
            /** @type {number} */
            var STORED = 14;
            /** @type {number} */
            var COPY_ = 15;
            /** @type {number} */
            var COPY = 16;
            /** @type {number} */
            var TABLE = 17;
            /** @type {number} */
            var LENLENS = 18;
            /** @type {number} */
            var CODELENS = 19;
            /** @type {number} */
            var LEN_ = 20;
            /** @type {number} */
            var LEN = 21;
            /** @type {number} */
            var LENEXT = 22;
            /** @type {number} */
            var DIST = 23;
            /** @type {number} */
            var DISTEXT = 24;
            /** @type {number} */
            var MATCH = 25;
            /** @type {number} */
            var LIT = 26;
            /** @type {number} */
            var CHECK = 27;
            /** @type {number} */
            var LENGTH = 28;
            /** @type {number} */
            var DONE = 29;
            /** @type {number} */
            var BAD = 30;
            /** @type {number} */
            var MEM = 31;
            /** @type {number} */
            var SYNC = 32;
            /** @type {number} */
            var ENOUGH_LENS = 852;
            /** @type {number} */
            var ENOUGH_DISTS = 592;
            /** @type {number} */
            var MAX_WBITS = 15;
            /** @type {number} */
            var DEF_WBITS = MAX_WBITS;
            /** @type {boolean} */
            var ge = true;
            /** @type {function(!Object): ?} */
            exports.inflateReset = inflateReset;
            /** @type {function(!Object, string): ?} */
            exports.inflateReset2 = inflateReset2;
            /** @type {function(!Object): ?} */
            exports.inflateResetKeep = inflateResetKeep;
            /** @type {function(string): ?} */
            exports.inflateInit = inflateInit;
            /** @type {function(string, !Function): ?} */
            exports.inflateInit2 = inflateInit2;
            /** @type {function(!Object, number): ?} */
            exports.inflate = inflate;
            /** @type {function(!Event): ?} */
            exports.inflateEnd = inflateEnd;
            /** @type {function(!Object, string): ?} */
            exports.inflateGetHeader = inflateGetHeader;
            /** @type {function(!Object, !Object): ?} */
            exports.inflateSetDictionary = inflateSetDictionary;
            /** @type {string} */
            exports.inflateInfo = "pako inflate (from Nodeca project)";
          },
          "zlib/constants.js" : function(someChunks, module, data) {
            module.exports = {
              Z_NO_FLUSH : 0,
              Z_PARTIAL_FLUSH : 1,
              Z_SYNC_FLUSH : 2,
              Z_FULL_FLUSH : 3,
              Z_FINISH : 4,
              Z_BLOCK : 5,
              Z_TREES : 6,
              Z_OK : 0,
              Z_STREAM_END : 1,
              Z_NEED_DICT : 2,
              Z_ERRNO : -1,
              Z_STREAM_ERROR : -2,
              Z_DATA_ERROR : -3,
              Z_BUF_ERROR : -5,
              Z_NO_COMPRESSION : 0,
              Z_BEST_SPEED : 1,
              Z_BEST_COMPRESSION : 9,
              Z_DEFAULT_COMPRESSION : -1,
              Z_FILTERED : 1,
              Z_HUFFMAN_ONLY : 2,
              Z_RLE : 3,
              Z_FIXED : 4,
              Z_DEFAULT_STRATEGY : 0,
              Z_BINARY : 0,
              Z_TEXT : 1,
              Z_UNKNOWN : 2,
              Z_DEFLATED : 8
            };
          },
          "zlib/messages.js" : function(someChunks, module, data) {
            module.exports = {
              2 : "need dictionary",
              1 : "stream end",
              0 : "",
              "-1" : "file error",
              "-2" : "stream error",
              "-3" : "data error",
              "-4" : "insufficient memory",
              "-5" : "buffer error",
              "-6" : "incompatible version"
            };
          },
          "zlib/zstream.js" : function(someChunks, module, data) {
            /**
             * @return {undefined}
             */
            function ZStream() {
              /** @type {null} */
              this.input = null;
              /** @type {number} */
              this.next_in = 0;
              /** @type {number} */
              this.avail_in = 0;
              /** @type {number} */
              this.total_in = 0;
              /** @type {null} */
              this.output = null;
              /** @type {number} */
              this.next_out = 0;
              /** @type {number} */
              this.avail_out = 0;
              /** @type {number} */
              this.total_out = 0;
              /** @type {string} */
              this.msg = "";
              /** @type {null} */
              this.state = null;
              /** @type {number} */
              this.data_type = 2;
              /** @type {number} */
              this.adler = 0;
            }
            /** @type {function(): undefined} */
            module.exports = ZStream;
          },
          "zlib/gzheader.js" : function(someChunks, module, data) {
            /**
             * @return {undefined}
             */
            function GZheader() {
              /** @type {number} */
              this.text = 0;
              /** @type {number} */
              this.time = 0;
              /** @type {number} */
              this.xflags = 0;
              /** @type {number} */
              this.os = 0;
              /** @type {null} */
              this.extra = null;
              /** @type {number} */
              this.extra_len = 0;
              /** @type {string} */
              this.name = "";
              /** @type {string} */
              this.comment = "";
              /** @type {number} */
              this.hcrc = 0;
              /** @type {boolean} */
              this.done = false;
            }
            /** @type {function(): undefined} */
            module.exports = GZheader;
          },
          "zlib/adler32.js" : function(constructor, mixin, doPost) {
            /**
             * @param {number} elem
             * @param {!Object} array
             * @param {number} e
             * @param {?} n
             * @return {?}
             */
            function on(elem, array, e, n) {
              /** @type {number} */
              var s1 = 65535 & elem | 0;
              /** @type {number} */
              var s2 = elem >>> 16 & 65535 | 0;
              /** @type {number} */
              var c = 0;
              for (; 0 !== e;) {
                c = e > 2E3 ? 2E3 : e;
                /** @type {number} */
                e = e - c;
                do {
                  /** @type {number} */
                  s1 = s1 + array[n++] | 0;
                  /** @type {number} */
                  s2 = s2 + s1 | 0;
                } while (--c);
                /** @type {number} */
                s1 = s1 % 65521;
                /** @type {number} */
                s2 = s2 % 65521;
              }
              return s1 | s2 << 16 | 0;
            }
            /** @type {function(number, !Object, number, ?): ?} */
            mixin.exports = on;
          },
          "zlib/crc32.js" : function(constructor, mixin, doPost) {
            /**
             * @return {?}
             */
            function _A_get() {
              var e;
              /** @type {!Array} */
              var row = [];
              /** @type {number} */
              var exception = 0;
              for (; exception < 256; exception++) {
                /** @type {number} */
                e = exception;
                /** @type {number} */
                var n = 0;
                for (; n < 8; n++) {
                  /** @type {number} */
                  e = 1 & e ? 3988292384 ^ e >>> 1 : e >>> 1;
                }
                /** @type {number} */
                row[exception] = e;
              }
              return row;
            }
            /**
             * @param {number} crc
             * @param {!Object} buf
             * @param {string} name
             * @param {string} offset
             * @return {?}
             */
            function update(crc, buf, name, offset) {
              var t = a;
              var index = offset + name;
              /** @type {number} */
              crc = crc ^ -1;
              /** @type {string} */
              var i = offset;
              for (; i < index; i++) {
                /** @type {number} */
                crc = crc >>> 8 ^ t[255 & (crc ^ buf[i])];
              }
              return crc ^ -1;
            }
            var a = _A_get();
            /** @type {function(number, !Object, string, string): ?} */
            mixin.exports = update;
          },
          "zlib/inffast.js" : function(constructor, mixin, doPost) {
            /** @type {number} */
            var TYPE$1 = 30;
            /** @type {number} */
            var BAD$1 = 12;
            /**
             * @param {!Object} strm
             * @param {number} start
             * @return {undefined}
             */
            mixin.exports = function(strm, start) {
              var state;
              var _in;
              var last;
              var _out;
              var beg;
              var end;
              var dmax;
              var wsize;
              var whave;
              var wnext;
              var s_window;
              var hold;
              var bits;
              var lcode;
              var dcode;
              var lmask;
              var dmask;
              var here;
              var op;
              var len;
              var dist;
              var from;
              var from_source;
              var input;
              var output;
              state = strm.state;
              _in = strm.next_in;
              input = strm.input;
              last = _in + (strm.avail_in - 5);
              _out = strm.next_out;
              output = strm.output;
              /** @type {number} */
              beg = _out - (start - strm.avail_out);
              end = _out + (strm.avail_out - 257);
              dmax = state.dmax;
              wsize = state.wsize;
              whave = state.whave;
              wnext = state.wnext;
              s_window = state.window;
              hold = state.hold;
              bits = state.bits;
              lcode = state.lencode;
              dcode = state.distcode;
              /** @type {number} */
              lmask = (1 << state.lenbits) - 1;
              /** @type {number} */
              dmask = (1 << state.distbits) - 1;
              e: do {
                if (bits < 15) {
                  hold = hold + (input[_in++] << bits);
                  bits = bits + 8;
                  hold = hold + (input[_in++] << bits);
                  bits = bits + 8;
                }
                here = lcode[hold & lmask];
                t: for (;;) {
                  if (op = here >>> 24, hold = hold >>> op, bits = bits - op, op = here >>> 16 & 255, 0 === op) {
                    /** @type {number} */
                    output[_out++] = 65535 & here;
                  } else {
                    if (!(16 & op)) {
                      if (0 === (64 & op)) {
                        here = lcode[(65535 & here) + (hold & (1 << op) - 1)];
                        continue t;
                      }
                      if (32 & op) {
                        /** @type {number} */
                        state.mode = BAD$1;
                        break e;
                      }
                      /** @type {string} */
                      strm.msg = "invalid literal/length code";
                      /** @type {number} */
                      state.mode = TYPE$1;
                      break e;
                    }
                    /** @type {number} */
                    len = 65535 & here;
                    /** @type {number} */
                    op = op & 15;
                    if (op) {
                      if (bits < op) {
                        hold = hold + (input[_in++] << bits);
                        bits = bits + 8;
                      }
                      /** @type {number} */
                      len = len + (hold & (1 << op) - 1);
                      /** @type {number} */
                      hold = hold >>> op;
                      /** @type {number} */
                      bits = bits - op;
                    }
                    if (bits < 15) {
                      hold = hold + (input[_in++] << bits);
                      bits = bits + 8;
                      hold = hold + (input[_in++] << bits);
                      bits = bits + 8;
                    }
                    here = dcode[hold & dmask];
                    r: for (;;) {
                      if (op = here >>> 24, hold = hold >>> op, bits = bits - op, op = here >>> 16 & 255, !(16 & op)) {
                        if (0 === (64 & op)) {
                          here = dcode[(65535 & here) + (hold & (1 << op) - 1)];
                          continue r;
                        }
                        /** @type {string} */
                        strm.msg = "invalid distance code";
                        /** @type {number} */
                        state.mode = TYPE$1;
                        break e;
                      }
                      if (dist = 65535 & here, op = op & 15, bits < op && (hold = hold + (input[_in++] << bits), bits = bits + 8, bits < op && (hold = hold + (input[_in++] << bits), bits = bits + 8)), dist = dist + (hold & (1 << op) - 1), dist > dmax) {
                        /** @type {string} */
                        strm.msg = "invalid distance too far back";
                        /** @type {number} */
                        state.mode = TYPE$1;
                        break e;
                      }
                      if (hold = hold >>> op, bits = bits - op, op = _out - beg, dist > op) {
                        if (op = dist - op, op > whave && state.sane) {
                          /** @type {string} */
                          strm.msg = "invalid distance too far back";
                          /** @type {number} */
                          state.mode = TYPE$1;
                          break e;
                        }
                        if (from = 0, from_source = s_window, 0 === wnext) {
                          if (from = from + (wsize - op), op < len) {
                            /** @type {number} */
                            len = len - op;
                            do {
                              output[_out++] = s_window[from++];
                            } while (--op);
                            /** @type {number} */
                            from = _out - dist;
                            from_source = output;
                          }
                        } else {
                          if (wnext < op) {
                            if (from = from + (wsize + wnext - op), op = op - wnext, op < len) {
                              /** @type {number} */
                              len = len - op;
                              do {
                                output[_out++] = s_window[from++];
                              } while (--op);
                              if (from = 0, wnext < len) {
                                op = wnext;
                                /** @type {number} */
                                len = len - op;
                                do {
                                  output[_out++] = s_window[from++];
                                } while (--op);
                                /** @type {number} */
                                from = _out - dist;
                                from_source = output;
                              }
                            }
                          } else {
                            if (from = from + (wnext - op), op < len) {
                              /** @type {number} */
                              len = len - op;
                              do {
                                output[_out++] = s_window[from++];
                              } while (--op);
                              /** @type {number} */
                              from = _out - dist;
                              from_source = output;
                            }
                          }
                        }
                        for (; len > 2;) {
                          output[_out++] = from_source[from++];
                          output[_out++] = from_source[from++];
                          output[_out++] = from_source[from++];
                          /** @type {number} */
                          len = len - 3;
                        }
                        if (len) {
                          output[_out++] = from_source[from++];
                          if (len > 1) {
                            output[_out++] = from_source[from++];
                          }
                        }
                      } else {
                        /** @type {number} */
                        from = _out - dist;
                        do {
                          output[_out++] = output[from++];
                          output[_out++] = output[from++];
                          output[_out++] = output[from++];
                          /** @type {number} */
                          len = len - 3;
                        } while (len > 2);
                        if (len) {
                          output[_out++] = output[from++];
                          if (len > 1) {
                            output[_out++] = output[from++];
                          }
                        }
                      }
                      break;
                    }
                  }
                  break;
                }
              } while (_in < last && _out < end);
              /** @type {number} */
              len = bits >> 3;
              /** @type {number} */
              _in = _in - len;
              /** @type {number} */
              bits = bits - (len << 3);
              /** @type {number} */
              hold = hold & (1 << bits) - 1;
              strm.next_in = _in;
              strm.next_out = _out;
              /** @type {number} */
              strm.avail_in = _in < last ? 5 + (last - _in) : 5 - (_in - last);
              /** @type {number} */
              strm.avail_out = _out < end ? 257 + (end - _out) : 257 - (_out - end);
              state.hold = hold;
              state.bits = bits;
            };
          },
          "zlib/inftrees.js" : function(req, task, runsInParallel) {
            var utils = req("../utils/common");
            /** @type {number} */
            var MAXBITS = 15;
            /** @type {number} */
            var ENOUGH_DISTS = 852;
            /** @type {number} */
            var ENOUGH_LENS = 592;
            /** @type {number} */
            var gce_ephemeral = 0;
            /** @type {number} */
            var DISTS = 1;
            /** @type {number} */
            var LENS = 2;
            /** @type {!Array} */
            var Math = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0];
            /** @type {!Array} */
            var process = [16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 16, 72, 78];
            /** @type {!Array} */
            var o = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 0, 0];
            /** @type {!Array} */
            var f = [16, 16, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 21, 22, 22, 23, 23, 24, 24, 25, 25, 26, 26, 27, 27, 28, 28, 29, 29, 64, 64];
            /**
             * @param {?} type
             * @param {?} s
             * @param {number} buf
             * @param {number} n
             * @param {!Object} table
             * @param {!Array} index
             * @param {!Object} b
             * @param {!Object} opts
             * @return {?}
             */
            task.exports = function(type, s, buf, n, table, index, b, opts) {
              var incr;
              var fill;
              var low;
              var mask;
              var next;
              var obj;
              var here_bits;
              var filter_error;
              var e;
              var bits = opts.bits;
              /** @type {number} */
              var len = 0;
              /** @type {number} */
              var i = 0;
              /** @type {number} */
              var min = 0;
              /** @type {number} */
              var max = 0;
              /** @type {number} */
              var root = 0;
              /** @type {number} */
              var curr = 0;
              /** @type {number} */
              var drop = 0;
              /** @type {number} */
              var left = 0;
              /** @type {number} */
              var used = 0;
              /** @type {number} */
              var huff = 0;
              /** @type {null} */
              var p = null;
              /** @type {number} */
              var c = 0;
              var count = new utils.Buf16(MAXBITS + 1);
              var offs = new utils.Buf16(MAXBITS + 1);
              /** @type {null} */
              var data = null;
              /** @type {number} */
              var w = 0;
              /** @type {number} */
              len = 0;
              for (; len <= MAXBITS; len++) {
                /** @type {number} */
                count[len] = 0;
              }
              /** @type {number} */
              i = 0;
              for (; i < n; i++) {
                count[s[buf + i]]++;
              }
              root = bits;
              /** @type {number} */
              max = MAXBITS;
              for (; max >= 1 && 0 === count[max]; max--) {
              }
              if (root > max && (root = max), 0 === max) {
                return table[index++] = 20971520, table[index++] = 20971520, opts.bits = 1, 0;
              }
              /** @type {number} */
              min = 1;
              for (; min < max && 0 === count[min]; min++) {
              }
              if (root < min) {
                /** @type {number} */
                root = min;
              }
              /** @type {number} */
              left = 1;
              /** @type {number} */
              len = 1;
              for (; len <= MAXBITS; len++) {
                if (left = left << 1, left = left - count[len], left < 0) {
                  return -1;
                }
              }
              if (left > 0 && (type === gce_ephemeral || 1 !== max)) {
                return -1;
              }
              /** @type {number} */
              offs[1] = 0;
              /** @type {number} */
              len = 1;
              for (; len < MAXBITS; len++) {
                offs[len + 1] = offs[len] + count[len];
              }
              /** @type {number} */
              i = 0;
              for (; i < n; i++) {
                if (0 !== s[buf + i]) {
                  /** @type {number} */
                  b[offs[s[buf + i]]++] = i;
                }
              }
              if (type === gce_ephemeral ? (p = data = b, obj = 19) : type === DISTS ? (p = Math, c = c - 257, data = process, w = w - 257, obj = 256) : (p = o, data = f, obj = -1), huff = 0, i = 0, len = min, next = index, curr = root, drop = 0, low = -1, used = 1 << root, mask = used - 1, type === DISTS && used > ENOUGH_DISTS || type === LENS && used > ENOUGH_LENS) {
                return 1;
              }
              for (;;) {
                /** @type {number} */
                here_bits = len - drop;
                if (b[i] < obj) {
                  /** @type {number} */
                  filter_error = 0;
                  e = b[i];
                } else {
                  if (b[i] > obj) {
                    filter_error = data[w + b[i]];
                    e = p[c + b[i]];
                  } else {
                    /** @type {number} */
                    filter_error = 96;
                    /** @type {number} */
                    e = 0;
                  }
                }
                /** @type {number} */
                incr = 1 << len - drop;
                /** @type {number} */
                fill = 1 << curr;
                /** @type {number} */
                min = fill;
                do {
                  /** @type {number} */
                  fill = fill - incr;
                  /** @type {number} */
                  table[next + (huff >> drop) + fill] = here_bits << 24 | filter_error << 16 | e | 0;
                } while (0 !== fill);
                /** @type {number} */
                incr = 1 << len - 1;
                for (; huff & incr;) {
                  /** @type {number} */
                  incr = incr >> 1;
                }
                if (0 !== incr ? (huff = huff & incr - 1, huff = huff + incr) : huff = 0, i++, 0 === --count[len]) {
                  if (len === max) {
                    break;
                  }
                  len = s[buf + b[i]];
                }
                if (len > root && (huff & mask) !== low) {
                  if (0 === drop) {
                    drop = root;
                  }
                  next = next + min;
                  /** @type {number} */
                  curr = len - drop;
                  /** @type {number} */
                  left = 1 << curr;
                  for (; curr + drop < max && (left = left - count[curr + drop], !(left <= 0));) {
                    curr++;
                    /** @type {number} */
                    left = left << 1;
                  }
                  if (used = used + (1 << curr), type === DISTS && used > ENOUGH_DISTS || type === LENS && used > ENOUGH_LENS) {
                    return 1;
                  }
                  /** @type {number} */
                  low = huff & mask;
                  /** @type {number} */
                  table[low] = root << 24 | curr << 16 | next - index | 0;
                }
              }
              return 0 !== huff && (table[next + huff] = len - drop << 24 | 64 << 16 | 0), opts.bits = root, 0;
            };
          }
        };
        var key;
        for (key in values) {
          /** @type {string} */
          values[key].folder = key.substring(0, key.lastIndexOf("/") + 1);
        }
        /**
         * @param {string} x
         * @return {?}
         */
        var resolve = function(x) {
          /** @type {!Array} */
          var r = [];
          return x = x.split("/").every(function(str) {
            return ".." == str ? r.pop() : "." == str || "" == str || r.push(str);
          }) ? r.join("/") : null, x ? values[x] || values[x + ".js"] || values[x + "/index.js"] : null;
        };
        /**
         * @param {!Object} self
         * @param {string} path
         * @return {?}
         */
        var write = function(self, path) {
          return self ? resolve(self.folder + "node_modules/" + path) || write(self.parent, path) : null;
        };
        /**
         * @param {!Object} type
         * @param {string} value
         * @return {?}
         */
        var build = function(type, value) {
          var f = value.match(/^\//) ? null : type ? value.match(/^\.\.?\//) ? resolve(type.folder + value) : write(type, value) : resolve(value);
          if (!f) {
            throw "module not found: " + value;
          }
          return f.exports || (f.parent = type, f(build.bind(null, f), f, f.exports = {})), f.exports;
        };
        return build(null, callback);
      },
      decompress : function(compressed) {
        if (!this.exports) {
          this.exports = this.require("inflate.js");
        }
        try {
          return this.exports.inflate(compressed);
        } catch (e) {
        }
      },
      hasUnityMarker : function(data) {
        /** @type {number} */
        var i = 10;
        /** @type {string} */
        var clefs = "UnityWeb Compressed Content (gzip)";
        if (i > data.length || 31 != data[0] || 139 != data[1]) {
          return false;
        }
        var passid = data[3];
        if (4 & passid) {
          if (i + 2 > data.length) {
            return false;
          }
          if (i = i + (2 + data[i] + (data[i + 1] << 8)), i > data.length) {
            return false;
          }
        }
        if (8 & passid) {
          for (; i < data.length && data[i];) {
            i++;
          }
          if (i + 1 > data.length) {
            return false;
          }
          i++;
        }
        return 16 & passid && String.fromCharCode.apply(null, data.subarray(i, i + clefs.length + 1)) == clefs + "\x00";
      }
    },
    brotli : {
      require : function(callback) {
        var values = {
          "decompress.js" : function(saveNotifs, events, startMonday) {
            events.exports = saveNotifs("./dec/decode").BrotliDecompressBuffer;
          },
          "dec/bit_reader.js" : function(someChunks, module, data) {
            /**
             * @param {!Element} input
             * @return {undefined}
             */
            function exports(input) {
              /** @type {!Uint8Array} */
              this.buf_ = new Uint8Array(outputByteCount);
              /** @type {!Element} */
              this.input_ = input;
              this.reset();
            }
            const size = 4096;
            const outputByteCount = 8224;
            const dePairParenthesise = 8191;
            const ephemeralDevices = new Uint32Array([0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535, 131071, 262143, 524287, 1048575, 2097151, 4194303, 8388607, 16777215]);
            /** @type {function(!Object, string): ?} */
            exports.READ_SIZE = size;
            exports.IBUF_MASK = dePairParenthesise;
            /**
             * @return {?}
             */
            exports.prototype.reset = function() {
              /** @type {number} */
              this.buf_ptr_ = 0;
              /** @type {number} */
              this.val_ = 0;
              /** @type {number} */
              this.pos_ = 0;
              /** @type {number} */
              this.bit_pos_ = 0;
              /** @type {number} */
              this.bit_end_pos_ = 0;
              /** @type {number} */
              this.eos_ = 0;
              this.readMoreInput();
              /** @type {number} */
              var e = 0;
              for (; e < 4; e++) {
                this.val_ |= this.buf_[this.pos_] << 8 * e;
                ++this.pos_;
              }
              return this.bit_end_pos_ > 0;
            };
            /**
             * @return {undefined}
             */
            exports.prototype.readMoreInput = function() {
              if (!(this.bit_end_pos_ > 256)) {
                if (this.eos_) {
                  if (this.bit_pos_ > this.bit_end_pos_) {
                    throw new Error("Unexpected end of input " + this.bit_pos_ + " " + this.bit_end_pos_);
                  }
                } else {
                  var j = this.buf_ptr_;
                  var id = this.input_.read(this.buf_, j, size);
                  if (id < 0) {
                    throw new Error("Unexpected end of input");
                  }
                  if (id < size) {
                    /** @type {number} */
                    this.eos_ = 1;
                    /** @type {number} */
                    var i = 0;
                    for (; i < 32; i++) {
                      /** @type {number} */
                      this.buf_[j + id + i] = 0;
                    }
                  }
                  if (0 === j) {
                    /** @type {number} */
                    i = 0;
                    for (; i < 32; i++) {
                      this.buf_[8192 + i] = this.buf_[i];
                    }
                    /** @type {function(!Object, string): ?} */
                    this.buf_ptr_ = size;
                  } else {
                    /** @type {number} */
                    this.buf_ptr_ = 0;
                  }
                  this.bit_end_pos_ += id << 3;
                }
              }
            };
            /**
             * @return {undefined}
             */
            exports.prototype.fillBitWindow = function() {
              for (; this.bit_pos_ >= 8;) {
                this.val_ >>>= 8;
                this.val_ |= this.buf_[this.pos_ & dePairParenthesise] << 24;
                ++this.pos_;
                /** @type {number} */
                this.bit_pos_ = this.bit_pos_ - 8 >>> 0;
                /** @type {number} */
                this.bit_end_pos_ = this.bit_end_pos_ - 8 >>> 0;
              }
            };
            /**
             * @param {number} size
             * @return {?}
             */
            exports.prototype.readBits = function(size) {
              if (32 - this.bit_pos_ < size) {
                this.fillBitWindow();
              }
              /** @type {number} */
              var t = this.val_ >>> this.bit_pos_ & ephemeralDevices[size];
              return this.bit_pos_ += size, t;
            };
            /** @type {function(!Element): undefined} */
            module.exports = exports;
          },
          "dec/context.js" : function(database2, options, link) {
            /** @type {!Uint8Array} */
            link.lookup = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 8, 12, 16, 12, 12, 20, 12, 16, 24, 28, 12, 12, 32, 12, 36, 12, 44, 44, 44, 44, 44, 44, 44, 44, 44, 44, 32, 32, 24, 40, 28, 12, 12, 48, 52, 52, 52, 48, 52, 52, 52, 48, 52, 52, 52, 52, 52, 48, 52, 52, 52, 52, 52, 48, 52, 52, 52, 52, 52, 24, 12, 28, 12, 12, 12, 56, 60, 60, 60, 56, 60, 60, 60, 56, 60, 60, 60, 60, 60, 56, 60, 60, 60, 60, 60, 56, 60, 60, 60, 60, 60, 
            24, 12, 28, 12, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 
            0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 
            3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0, 8, 8, 8, 8, 8, 
            8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 32, 32, 32, 
            32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 
            48, 56, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 
            62, 63, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 
            62, 63, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 8, 9, 9, 9, 9, 10, 10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16, 17, 17, 17, 17, 18, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23, 23, 23, 23, 24, 24, 24, 24, 25, 25, 25, 25, 26, 26, 26, 26, 27, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 29, 30, 30, 30, 30, 31, 31, 31, 31, 32, 32, 32, 
            32, 33, 33, 33, 33, 34, 34, 34, 34, 35, 35, 35, 35, 36, 36, 36, 36, 37, 37, 37, 37, 38, 38, 38, 38, 39, 39, 39, 39, 40, 40, 40, 40, 41, 41, 41, 41, 42, 42, 42, 42, 43, 43, 43, 43, 44, 44, 44, 44, 45, 45, 45, 45, 46, 46, 46, 46, 47, 47, 47, 47, 48, 48, 48, 48, 49, 49, 49, 49, 50, 50, 50, 50, 51, 51, 51, 51, 52, 52, 52, 52, 53, 53, 53, 53, 54, 54, 54, 54, 55, 55, 55, 55, 56, 56, 56, 56, 57, 57, 57, 57, 58, 58, 58, 58, 59, 59, 59, 59, 60, 60, 60, 60, 61, 61, 61, 61, 62, 62, 62, 62, 63, 63, 
            63, 63, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
            /** @type {!Uint16Array} */
            link.lookupOffsets = new Uint16Array([1024, 1536, 1280, 1536, 0, 256, 768, 512]);
          },
          "dec/decode.js" : function(require, epxorts, module) {
            /**
             * @param {!Object} s
             * @return {?}
             */
            function get(s) {
              var t;
              return 0 === s.readBits(1) ? 16 : (t = s.readBits(3), t > 0 ? 17 + t : (t = s.readBits(3), t > 0 ? 8 + t : 17));
            }
            /**
             * @param {!Object} s
             * @return {?}
             */
            function decode(s) {
              if (s.readBits(1)) {
                var i = s.readBits(3);
                return 0 === i ? 1 : s.readBits(i) + (1 << i);
              }
              return 0;
            }
            /**
             * @return {undefined}
             */
            function Object() {
              /** @type {number} */
              this.meta_block_length = 0;
              /** @type {number} */
              this.input_end = 0;
              /** @type {number} */
              this.is_uncompressed = 0;
              /** @type {boolean} */
              this.is_metadata = false;
            }
            /**
             * @param {!Object} source
             * @return {?}
             */
            function stringify(source) {
              var numVisitors;
              var r;
              var n;
              var thisctr = new Object;
              if (thisctr.input_end = source.readBits(1), thisctr.input_end && source.readBits(1)) {
                return thisctr;
              }
              if (numVisitors = source.readBits(2) + 4, 7 === numVisitors) {
                if (thisctr.is_metadata = true, 0 !== source.readBits(1)) {
                  throw new Error("Invalid reserved bit");
                }
                if (r = source.readBits(2), 0 === r) {
                  return thisctr;
                }
                /** @type {number} */
                n = 0;
                for (; n < r; n++) {
                  var data = source.readBits(8);
                  if (n + 1 === r && r > 1 && 0 === data) {
                    throw new Error("Invalid size byte");
                  }
                  thisctr.meta_block_length |= data << 8 * n;
                }
              } else {
                /** @type {number} */
                n = 0;
                for (; n < numVisitors; ++n) {
                  var data = source.readBits(4);
                  if (n + 1 === numVisitors && numVisitors > 4 && 0 === data) {
                    throw new Error("Invalid size nibble");
                  }
                  thisctr.meta_block_length |= data << 4 * n;
                }
              }
              return ++thisctr.meta_block_length, thisctr.input_end || thisctr.is_metadata || (thisctr.is_uncompressed = source.readBits(1)), thisctr;
            }
            /**
             * @param {number} properties
             * @param {number} id
             * @param {!Object} d
             * @return {?}
             */
            function clone(properties, id, d) {
              var curNum;
              return d.fillBitWindow(), id = id + (d.val_ >>> d.bit_pos_ & D), curNum = properties[id].bits - total, curNum > 0 && (d.bit_pos_ += total, id = id + properties[id].value, id = id + (d.val_ >>> d.bit_pos_ & (1 << curNum) - 1)), d.bit_pos_ += properties[id].bits, properties[id].value;
            }
            /**
             * @param {?} array
             * @param {number} length
             * @param {?} target
             * @param {!Object} d
             * @return {undefined}
             */
            function set(array, length, target, d) {
              /** @type {number} */
              var i = 0;
              var a = firstOccurrenceIdx;
              /** @type {number} */
              var value = 0;
              /** @type {number} */
              var o = 0;
              /** @type {number} */
              var error = 32768;
              /** @type {!Array} */
              var errors = [];
              /** @type {number} */
              var u = 0;
              for (; u < 32; u++) {
                errors.push(new Error(0, 0));
              }
              callback(errors, 0, 5, array, x);
              for (; i < length && error > 0;) {
                var val;
                /** @type {number} */
                var i = 0;
                if (d.readMoreInput(), d.fillBitWindow(), i = i + (d.val_ >>> d.bit_pos_ & 31), d.bit_pos_ += errors[i].bits, val = 255 & errors[i].value, val < r) {
                  /** @type {number} */
                  value = 0;
                  /** @type {number} */
                  target[i++] = val;
                  if (0 !== val) {
                    /** @type {number} */
                    a = val;
                    /** @type {number} */
                    error = error - (32768 >> val);
                  }
                } else {
                  var min;
                  var count;
                  /** @type {number} */
                  var bits = val - 14;
                  /** @type {number} */
                  var n = 0;
                  if (val === r && (n = a), o !== n && (value = 0, o = n), min = value, value > 0 && (value = value - 2, value = value << bits), value = value + (d.readBits(bits) + 3), count = value - min, i + count > length) {
                    throw new Error("[ReadHuffmanCodeLengths] symbol + repeat_delta > num_symbols");
                  }
                  /** @type {number} */
                  var x = 0;
                  for (; x < count; x++) {
                    target[i + x] = o;
                  }
                  /** @type {number} */
                  i = i + count;
                  if (0 !== o) {
                    /** @type {number} */
                    error = error - (count << 15 - o);
                  }
                }
              }
              if (0 !== error) {
                throw new Error("[ReadHuffmanCodeLengths] space = " + error);
              }
              for (; i < length; i++) {
                /** @type {number} */
                target[i] = 0;
              }
            }
            /**
             * @param {number} i
             * @param {!Object} values
             * @param {number} k
             * @param {!Object} d
             * @return {?}
             */
            function index(i, values, k, d) {
              var e;
              /** @type {number} */
              var result = 0;
              /** @type {!Uint8Array} */
              var obj = new Uint8Array(i);
              if (d.readMoreInput(), e = d.readBits(2), 1 === e) {
                var k;
                /** @type {number} */
                var j = i - 1;
                /** @type {number} */
                var bits = 0;
                /** @type {!Int32Array} */
                var header = new Int32Array(4);
                var len__ = d.readBits(2) + 1;
                for (; j;) {
                  /** @type {number} */
                  j = j >> 1;
                  ++bits;
                }
                /** @type {number} */
                k = 0;
                for (; k < len__; ++k) {
                  /** @type {number} */
                  header[k] = d.readBits(bits) % i;
                  /** @type {number} */
                  obj[header[k]] = 2;
                }
                switch(obj[header[0]] = 1, len__) {
                  case 1:
                    break;
                  case 3:
                    if (header[0] === header[1] || header[0] === header[2] || header[1] === header[2]) {
                      throw new Error("[ReadHuffmanCode] invalid symbols");
                    }
                    break;
                  case 2:
                    if (header[0] === header[1]) {
                      throw new Error("[ReadHuffmanCode] invalid symbols");
                    }
                    /** @type {number} */
                    obj[header[1]] = 1;
                    break;
                  case 4:
                    if (header[0] === header[1] || header[0] === header[2] || header[0] === header[3] || header[1] === header[2] || header[1] === header[3] || header[2] === header[3]) {
                      throw new Error("[ReadHuffmanCode] invalid symbols");
                    }
                    if (d.readBits(1)) {
                      /** @type {number} */
                      obj[header[2]] = 3;
                      /** @type {number} */
                      obj[header[3]] = 3;
                    } else {
                      /** @type {number} */
                      obj[header[0]] = 2;
                    }
                }
              } else {
                /** @type {!Uint8Array} */
                var pos = new Uint8Array(x);
                /** @type {number} */
                var error = 32;
                /** @type {number} */
                var requestedAnnotationType = 0;
                /** @type {!Array} */
                var in_tokens = [new Error(2, 0), new Error(2, 4), new Error(2, 3), new Error(3, 2), new Error(2, 0), new Error(2, 4), new Error(2, 3), new Error(4, 1), new Error(2, 0), new Error(2, 4), new Error(2, 3), new Error(3, 2), new Error(2, 0), new Error(2, 4), new Error(2, 3), new Error(4, 5)];
                k = e;
                for (; k < x && error > 0; ++k) {
                  var tmp;
                  var j = json[k];
                  /** @type {number} */
                  var i = 0;
                  d.fillBitWindow();
                  /** @type {number} */
                  i = i + (d.val_ >>> d.bit_pos_ & 15);
                  d.bit_pos_ += in_tokens[i].bits;
                  tmp = in_tokens[i].value;
                  pos[j] = tmp;
                  if (0 !== tmp) {
                    /** @type {number} */
                    error = error - (32 >> tmp);
                    ++requestedAnnotationType;
                  }
                }
                if (1 !== requestedAnnotationType && 0 !== error) {
                  throw new Error("[ReadHuffmanCode] invalid num_codes or space");
                }
                set(pos, i, obj, d);
              }
              if (result = callback(values, k, total, obj, i), 0 === result) {
                throw new Error("[ReadHuffmanCode] BuildHuffmanTable failed: ");
              }
              return result;
            }
            /**
             * @param {number} args
             * @param {number} type
             * @param {!Object} c
             * @return {?}
             */
            function render(args, type, c) {
              var a;
              var i;
              return a = clone(args, type, c), i = photos.kBlockLengthPrefixCode[a].nbits, photos.kBlockLengthPrefixCode[a].offset + c.readBits(i);
            }
            /**
             * @param {?} name
             * @param {!Array} data
             * @param {number} s
             * @return {?}
             */
            function func(name, data, s) {
              var _d;
              return name < character ? (s = s + thisShape[name], s = s & 3, _d = data[s] + sourceData[name]) : _d = name - character + 1, _d;
            }
            /**
             * @param {?} data
             * @param {number} k
             * @return {undefined}
             */
            function update(data, k) {
              var version = data[k];
              /** @type {number} */
              var j = k;
              for (; j; --j) {
                data[j] = data[j - 1];
              }
              data[0] = version;
            }
            /**
             * @param {?} array
             * @param {number} length
             * @return {undefined}
             */
            function last(array, length) {
              var i;
              /** @type {!Uint8Array} */
              var values = new Uint8Array(256);
              /** @type {number} */
              i = 0;
              for (; i < 256; ++i) {
                /** @type {number} */
                values[i] = i;
              }
              /** @type {number} */
              i = 0;
              for (; i < length; ++i) {
                var n = array[i];
                /** @type {number} */
                array[i] = values[n];
                if (n) {
                  update(values, n);
                }
              }
            }
            /**
             * @param {number} channels
             * @param {number} t
             * @return {undefined}
             */
            function Ebur128(channels, t) {
              /** @type {number} */
              this.alphabet_size = channels;
              /** @type {number} */
              this.num_htrees = t;
              /** @type {!Array} */
              this.codes = new Array(t + t * deltaDisplacement[channels + 31 >>> 5]);
              /** @type {!Uint32Array} */
              this.htrees = new Uint32Array(t);
            }
            /**
             * @param {number} n
             * @param {!Object} s
             * @return {?}
             */
            function create(n, s) {
              var r;
              var values;
              var i;
              var node = {
                num_htrees : null,
                context_map : null
              };
              /** @type {number} */
              var offset = 0;
              s.readMoreInput();
              var mappedIndex = node.num_htrees = decode(s) + 1;
              /** @type {!Uint8Array} */
              var out = node.context_map = new Uint8Array(n);
              if (mappedIndex <= 1) {
                return node;
              }
              r = s.readBits(1);
              if (r) {
                offset = s.readBits(4) + 1;
              }
              /** @type {!Array} */
              values = [];
              /** @type {number} */
              i = 0;
              for (; i < val; i++) {
                values[i] = new Error(0, 0);
              }
              index(mappedIndex + offset, values, 0, s);
              /** @type {number} */
              i = 0;
              for (; i < n;) {
                var x;
                if (s.readMoreInput(), x = clone(values, 0, s), 0 === x) {
                  /** @type {number} */
                  out[i] = 0;
                  ++i;
                } else {
                  if (x <= offset) {
                    var p = 1 + (1 << x) + s.readBits(x);
                    for (; --p;) {
                      if (i >= n) {
                        throw new Error("[DecodeContextMap] i >= context_map_size");
                      }
                      /** @type {number} */
                      out[i] = 0;
                      ++i;
                    }
                  } else {
                    /** @type {number} */
                    out[i] = x - offset;
                    ++i;
                  }
                }
              }
              return s.readBits(1) && last(out, n), node;
            }
            /**
             * @param {number} i
             * @param {number} data
             * @param {number} key
             * @param {!Array} props
             * @param {!Object} object
             * @param {!Array} keys
             * @param {!Object} value
             * @return {undefined}
             */
            function omit(i, data, key, props, object, keys, value) {
              var v;
              /** @type {number} */
              var domain = 2 * key;
              /** @type {number} */
              var parent = key;
              var actual = clone(data, key * val, value);
              v = 0 === actual ? object[domain + (1 & keys[parent])] : 1 === actual ? object[domain + (keys[parent] - 1 & 1)] + 1 : actual - 2;
              if (v >= i) {
                /** @type {number} */
                v = v - i;
              }
              props[key] = v;
              object[domain + (1 & keys[parent])] = v;
              ++keys[parent];
            }
            /**
             * @param {!Object} r
             * @param {number} x
             * @param {number} c
             * @param {!Object} data
             * @param {number} key
             * @param {!Object} s
             * @return {undefined}
             */
            function fn(r, x, c, data, key, s) {
              var len;
              var i = key + 1;
              /** @type {number} */
              var j = c & key;
              /** @type {number} */
              var d = s.pos_ & Buffer.IBUF_MASK;
              if (x < 8 || s.bit_pos_ + (x << 3) < s.bit_end_pos_) {
                for (; x-- > 0;) {
                  s.readMoreInput();
                  data[j++] = s.readBits(8);
                  if (j === i) {
                    r.write(data, i);
                    /** @type {number} */
                    j = 0;
                  }
                }
              } else {
                if (s.bit_end_pos_ < 32) {
                  throw new Error("[CopyUncompressedBlockToOutput] br.bit_end_pos_ < 32");
                }
                for (; s.bit_pos_ < 32;) {
                  /** @type {number} */
                  data[j] = s.val_ >>> s.bit_pos_;
                  s.bit_pos_ += 8;
                  ++j;
                  --x;
                }
                if (len = s.bit_end_pos_ - s.bit_pos_ >> 3, d + len > Buffer.IBUF_MASK) {
                  /** @type {number} */
                  var offset = Buffer.IBUF_MASK + 1 - d;
                  /** @type {number} */
                  var k = 0;
                  for (; k < offset; k++) {
                    data[j + k] = s.buf_[d + k];
                  }
                  /** @type {number} */
                  len = len - offset;
                  /** @type {number} */
                  j = j + offset;
                  /** @type {number} */
                  x = x - offset;
                  /** @type {number} */
                  d = 0;
                }
                /** @type {number} */
                k = 0;
                for (; k < len; k++) {
                  data[j + k] = s.buf_[d + k];
                }
                if (j = j + len, x = x - len, j >= i) {
                  r.write(data, i);
                  /** @type {number} */
                  j = j - i;
                  /** @type {number} */
                  k = 0;
                  for (; k < j; k++) {
                    data[k] = data[i + k];
                  }
                }
                for (; j + x >= i;) {
                  if (len = i - j, s.input_.read(data, j, len) < len) {
                    throw new Error("[CopyUncompressedBlockToOutput] not enough bytes");
                  }
                  r.write(data, i);
                  /** @type {number} */
                  x = x - len;
                  /** @type {number} */
                  j = 0;
                }
                if (s.input_.read(data, j, x) < x) {
                  throw new Error("[CopyUncompressedBlockToOutput] not enough bytes");
                }
                s.reset();
              }
            }
            /**
             * @param {!Object} stream
             * @return {?}
             */
            function encodeMsgId(stream) {
              /** @type {number} */
              var start = stream.bit_pos_ + 7 & -8;
              var r = stream.readBits(start - stream.bit_pos_);
              return 0 == r;
            }
            /**
             * @param {!Object} year
             * @return {?}
             */
            function now(year) {
              var result = new Date(year);
              var data = new Buffer(result);
              get(data);
              var stringified = stringify(data);
              return stringified.meta_block_length;
            }
            /**
             * @param {!Object} b
             * @param {string} n
             * @return {?}
             */
            function benchmark(b, n) {
              var x = new Date(b);
              if (null == n) {
                n = now(b);
              }
              /** @type {!Uint8Array} */
              var buff = new Uint8Array(n);
              var data = new Float32Array(buff);
              return encode(x, data), data.pos < data.buffer.length && (data.buffer = data.buffer.subarray(0, data.pos)), data.buffer;
            }
            /**
             * @param {?} n
             * @param {!Object} d
             * @return {undefined}
             */
            function encode(n, d) {
              var name;
              var FALSE;
              var value;
              var t;
              var data;
              var start;
              var args;
              var v;
              var id;
              /** @type {number} */
              var c = 0;
              /** @type {number} */
              var ref = 0;
              /** @type {number} */
              var userId = 0;
              /** @type {number} */
              var result = 0;
              /** @type {!Array} */
              var form = [16, 15, 11, 4];
              /** @type {number} */
              var target = 0;
              /** @type {number} */
              var item = 0;
              /** @type {number} */
              var type = 0;
              /** @type {!Array} */
              var dota = [new Ebur128(0, 0), new Ebur128(0, 0), new Ebur128(0, 0)];
              const _ = 128 + Buffer.READ_SIZE;
              id = new Buffer(n);
              userId = get(id);
              /** @type {number} */
              FALSE = (1 << userId) - 16;
              /** @type {number} */
              value = 1 << userId;
              /** @type {number} */
              t = value - 1;
              /** @type {!Uint8Array} */
              data = new Uint8Array(value + _ + options.maxDictionaryWordLength);
              /** @type {number} */
              start = value;
              /** @type {!Array} */
              args = [];
              /** @type {!Array} */
              v = [];
              /** @type {number} */
              var i = 0;
              for (; i < 3240; i++) {
                args[i] = new Error(0, 0);
                v[i] = new Error(0, 0);
              }
              for (; !ref;) {
                var html;
                var j;
                var upperLeft;
                var m;
                var upperRight;
                var notificationSiteId;
                var targetOffsetHeight;
                var index;
                var config;
                /** @type {number} */
                var len = 0;
                /** @type {!Array} */
                var o = [1 << 28, 1 << 28, 1 << 28];
                /** @type {!Array} */
                var url = [0];
                /** @type {!Array} */
                var data = [1, 1, 1];
                /** @type {!Array} */
                var value = [0, 1, 0, 1, 0, 1];
                /** @type {!Array} */
                var type = [0];
                /** @type {null} */
                var y = null;
                /** @type {null} */
                var row = null;
                /** @type {null} */
                var doc = null;
                /** @type {number} */
                var workingWord = 0;
                /** @type {null} */
                var k = null;
                /** @type {number} */
                var i = 0;
                /** @type {number} */
                var bitmaskOccupies = 0;
                /** @type {null} */
                var scroll = null;
                /** @type {number} */
                var prop = 0;
                /** @type {number} */
                var path = 0;
                /** @type {number} */
                var set = 0;
                /** @type {number} */
                name = 0;
                for (; name < 3; ++name) {
                  /** @type {null} */
                  dota[name].codes = null;
                  /** @type {null} */
                  dota[name].htrees = null;
                }
                id.readMoreInput();
                var val = stringify(id);
                if (len = val.meta_block_length, c + len > d.buffer.length) {
                  /** @type {!Uint8Array} */
                  var data = new Uint8Array(c + len);
                  data.set(d.buffer);
                  /** @type {!Uint8Array} */
                  d.buffer = data;
                }
                if (ref = val.input_end, html = val.is_uncompressed, val.is_metadata) {
                  encodeMsgId(id);
                  for (; len > 0; --len) {
                    id.readMoreInput();
                    id.readBits(8);
                  }
                } else {
                  if (0 !== len) {
                    if (html) {
                      /** @type {number} */
                      id.bit_pos_ = id.bit_pos_ + 7 & -8;
                      fn(d, len, c, data, t, id);
                      c = c + len;
                    } else {
                      /** @type {number} */
                      name = 0;
                      for (; name < 3; ++name) {
                        data[name] = decode(id) + 1;
                        if (data[name] >= 2) {
                          index(data[name] + 2, args, name * val, id);
                          index(n, v, name * val, id);
                          o[name] = render(v, name * val, id);
                          /** @type {number} */
                          type[name] = 1;
                        }
                      }
                      id.readMoreInput();
                      j = id.readBits(2);
                      upperLeft = character + (id.readBits(4) << j);
                      /** @type {number} */
                      m = (1 << j) - 1;
                      upperRight = upperLeft + (48 << j);
                      /** @type {!Uint8Array} */
                      row = new Uint8Array(data[0]);
                      /** @type {number} */
                      name = 0;
                      for (; name < data[0]; ++name) {
                        id.readMoreInput();
                        /** @type {number} */
                        row[name] = id.readBits(2) << 1;
                      }
                      var event = create(data[0] << bits, id);
                      notificationSiteId = event.num_htrees;
                      y = event.context_map;
                      var target = create(data[2] << bitsInLeft, id);
                      targetOffsetHeight = target.num_htrees;
                      doc = target.context_map;
                      dota[0] = new Ebur128(channels, notificationSiteId);
                      dota[1] = new Ebur128(meta, data[1]);
                      dota[2] = new Ebur128(upperRight, targetOffsetHeight);
                      /** @type {number} */
                      name = 0;
                      for (; name < 3; ++name) {
                        dota[name].decode(id);
                      }
                      /** @type {number} */
                      k = 0;
                      /** @type {number} */
                      scroll = 0;
                      /** @type {number} */
                      index = row[url[0]];
                      path = self.lookupOffsets[index];
                      set = self.lookupOffsets[index + 1];
                      config = dota[1].htrees[0];
                      for (; len > 0;) {
                        var api;
                        var b;
                        var a;
                        var nextValidI;
                        var chunkLength;
                        var n;
                        var p;
                        var value;
                        var name;
                        var i;
                        var e;
                        id.readMoreInput();
                        if (0 === o[1]) {
                          omit(data[1], args, 1, url, value, type, id);
                          o[1] = render(v, val, id);
                          config = dota[1].htrees[url[1]];
                        }
                        --o[1];
                        api = clone(dota[1].codes, config, id);
                        /** @type {number} */
                        b = api >> 6;
                        if (b >= 2) {
                          /** @type {number} */
                          b = b - 2;
                          /** @type {number} */
                          p = -1;
                        } else {
                          /** @type {number} */
                          p = 0;
                        }
                        a = photos.kInsertRangeLut[b] + (api >> 3 & 7);
                        nextValidI = photos.kCopyRangeLut[b] + (7 & api);
                        chunkLength = photos.kInsertLengthPrefixCode[a].offset + id.readBits(photos.kInsertLengthPrefixCode[a].nbits);
                        n = photos.kCopyLengthPrefixCode[nextValidI].offset + id.readBits(photos.kCopyLengthPrefixCode[nextValidI].nbits);
                        /** @type {number} */
                        item = data[c - 1 & t];
                        /** @type {number} */
                        type = data[c - 2 & t];
                        /** @type {number} */
                        i = 0;
                        for (; i < chunkLength; ++i) {
                          id.readMoreInput();
                          if (0 === o[0]) {
                            omit(data[0], args, 0, url, value, type, id);
                            o[0] = render(v, 0, id);
                            /** @type {number} */
                            workingWord = url[0] << bits;
                            /** @type {number} */
                            k = workingWord;
                            /** @type {number} */
                            index = row[url[0]];
                            path = self.lookupOffsets[index];
                            set = self.lookupOffsets[index + 1];
                          }
                          /** @type {number} */
                          name = self.lookup[path + item] | self.lookup[set + type];
                          i = y[k + name];
                          --o[0];
                          type = item;
                          item = clone(dota[0].codes, dota[0].htrees[i], id);
                          data[c & t] = item;
                          if ((c & t) === t) {
                            d.write(data, value);
                          }
                          ++c;
                        }
                        if (len = len - chunkLength, len <= 0) {
                          break;
                        }
                        if (p < 0) {
                          if (id.readMoreInput(), 0 === o[2] && (omit(data[2], args, 2, url, value, type, id), o[2] = render(v, 2160, id), bitmaskOccupies = url[2] << bitsInLeft, scroll = bitmaskOccupies), --o[2], name = 255 & (n > 4 ? 3 : n - 2), prop = doc[scroll + name], p = clone(dota[2].codes, dota[2].htrees[prop], id), p >= upperLeft) {
                            var s;
                            var x;
                            var i;
                            /** @type {number} */
                            p = p - upperLeft;
                            /** @type {number} */
                            x = p & m;
                            /** @type {number} */
                            p = p >> j;
                            /** @type {number} */
                            s = (p >> 1) + 1;
                            /** @type {number} */
                            i = (2 + (1 & p) << s) - 4;
                            p = upperLeft + (i + id.readBits(s) << j) + x;
                          }
                        }
                        if (value = func(p, form, target), value < 0) {
                          throw new Error("[BrotliDecompress] invalid distance");
                        }
                        if (result = c < FALSE && result !== FALSE ? c : FALSE, e = c & t, value > result) {
                          if (!(n >= options.minDictionaryWordLength && n <= options.maxDictionaryWordLength)) {
                            throw new Error("Invalid backward reference. pos: " + c + " distance: " + value + " len: " + n + " bytes left: " + len);
                          }
                          i = options.offsetsByLength[n];
                          /** @type {number} */
                          var gid = value - result - 1;
                          var string = options.sizeBitsByLength[n];
                          /** @type {number} */
                          var FLIPPED_VERTICALLY_FLAG = (1 << string) - 1;
                          /** @type {number} */
                          var flipV = gid & FLIPPED_VERTICALLY_FLAG;
                          /** @type {number} */
                          var end = gid >> string;
                          if (i = i + flipV * n, !(end < ctx.kNumTransforms)) {
                            throw new Error("Invalid backward reference. pos: " + c + " distance: " + value + " len: " + n + " bytes left: " + len);
                          }
                          var p = ctx.transformDictionaryWord(data, e, i, n, end);
                          if (e = e + p, c = c + p, len = len - p, e >= start) {
                            d.write(data, value);
                            /** @type {number} */
                            var i = 0;
                            for (; i < e - start; i++) {
                              /** @type {number} */
                              data[i] = data[start + i];
                            }
                          }
                        } else {
                          if (p > 0 && (form[3 & target] = value, ++target), n > len) {
                            throw new Error("Invalid backward reference. pos: " + c + " distance: " + value + " len: " + n + " bytes left: " + len);
                          }
                          /** @type {number} */
                          i = 0;
                          for (; i < n; ++i) {
                            /** @type {number} */
                            data[c & t] = data[c - value & t];
                            if ((c & t) === t) {
                              d.write(data, value);
                            }
                            ++c;
                            --len;
                          }
                        }
                        /** @type {number} */
                        item = data[c - 1 & t];
                        /** @type {number} */
                        type = data[c - 2 & t];
                      }
                      /** @type {number} */
                      c = c & 1073741823;
                    }
                  }
                }
              }
              d.write(data, c & t);
            }
            var Date = require("./streams").BrotliInput;
            var Float32Array = require("./streams").BrotliOutput;
            var Buffer = require("./bit_reader");
            var options = require("./dictionary");
            var Error = require("./huffman").HuffmanCode;
            var callback = require("./huffman").BrotliBuildHuffmanTable;
            var self = require("./context");
            var photos = require("./prefix");
            var ctx = require("./transform");
            const firstOccurrenceIdx = 8;
            const r = 16;
            const channels = 256;
            const meta = 704;
            const n = 26;
            const bits = 6;
            const bitsInLeft = 2;
            const total = 8;
            const D = 255;
            const val = 1080;
            const x = 18;
            const json = new Uint8Array([1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
            const character = 16;
            const thisShape = new Uint8Array([3, 2, 1, 0, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2]);
            const sourceData = new Int8Array([0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3]);
            const deltaDisplacement = new Uint16Array([256, 402, 436, 468, 500, 534, 566, 598, 630, 662, 694, 726, 758, 790, 822, 854, 886, 920, 952, 984, 1016, 1048, 1080]);
            /**
             * @param {!Object} id
             * @return {undefined}
             */
            Ebur128.prototype.decode = function(id) {
              var selectionAnimationEffectSymbol;
              var i;
              /** @type {number} */
              var value = 0;
              /** @type {number} */
              selectionAnimationEffectSymbol = 0;
              for (; selectionAnimationEffectSymbol < this.num_htrees; ++selectionAnimationEffectSymbol) {
                this.htrees[selectionAnimationEffectSymbol] = value;
                i = index(this.alphabet_size, this.codes, value, id);
                value = value + i;
              }
            };
            /** @type {function(!Object): ?} */
            module.BrotliDecompressedSize = now;
            /** @type {function(!Object, string): ?} */
            module.BrotliDecompressBuffer = benchmark;
            /** @type {function(?, !Object): undefined} */
            module.BrotliDecompress = encode;
            options.init();
          },
          "dec/dictionary.js" : function(view, transformer, that) {
            var instance = view("./dictionary-browser");
            /**
             * @return {undefined}
             */
            that.init = function() {
              that.dictionary = instance.init();
            };
            /** @type {!Uint32Array} */
            that.offsetsByLength = new Uint32Array([0, 0, 0, 0, 0, 4096, 9216, 21504, 35840, 44032, 53248, 63488, 74752, 87040, 93696, 100864, 104704, 106752, 108928, 113536, 115968, 118528, 119872, 121280, 122016]);
            /** @type {!Uint8Array} */
            that.sizeBitsByLength = new Uint8Array([0, 0, 0, 0, 10, 10, 11, 11, 10, 10, 10, 10, 10, 9, 9, 8, 7, 7, 8, 7, 7, 6, 6, 5, 5]);
            /** @type {number} */
            that.minDictionaryWordLength = 4;
            /** @type {number} */
            that.maxDictionaryWordLength = 24;
          },
          "dec/dictionary.bin.js" : function(constructor, mixin, doPost) {
            /** @type {string} */
            mixin.exports = "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";
          },
          "dec/dictionary-browser.js" : function(require, epxorts, module) {
            var base64 = require("base64-js");
            /**
             * @return {?}
             */
            module.init = function() {
              var obj = require("./decode").BrotliDecompressBuffer;
              var input = base64.toByteArray(require("./dictionary.bin.js"));
              return obj(input);
            };
          },
          "dec/huffman.js" : function(code, ag, Y) {
            /**
             * @param {number} set
             * @param {number} row
             * @return {undefined}
             */
            function Node(set, row) {
              /** @type {number} */
              this.bits = set;
              /** @type {number} */
              this.value = row;
            }
            /**
             * @param {number} bitmap
             * @param {number} value
             * @return {?}
             */
            function $(bitmap, value) {
              /** @type {number} */
              var bit = 1 << value - 1;
              for (; bitmap & bit;) {
                /** @type {number} */
                bit = bit >> 1;
              }
              return (bitmap & bit - 1) + bit;
            }
            /**
             * @param {!Object} node
             * @param {number} _
             * @param {number} i
             * @param {number} j
             * @param {!Object} data
             * @return {undefined}
             */
            function format(node, _, i, j, data) {
              do {
                /** @type {number} */
                j = j - i;
                node[_ + j] = new Node(data.bits, data.value);
              } while (j > 0);
            }
            /**
             * @param {!Int32Array} p
             * @param {number} i
             * @param {number} x
             * @return {?}
             */
            function g(p, i, x) {
              /** @type {number} */
              var j = 1 << i - x;
              for (; i < h && (j = j - p[i], !(j <= 0));) {
                ++i;
                /** @type {number} */
                j = j << 1;
              }
              return i - x;
            }
            /** @type {function(number, number): undefined} */
            Y.HuffmanCode = Node;
            const h = 15;
            /**
             * @param {!Object} data
             * @param {number} pos
             * @param {number} n
             * @param {?} keys
             * @param {number} val
             * @return {?}
             */
            Y.BrotliBuildHuffmanTable = function(data, pos, n, keys, val) {
              var type;
              var i;
              var j;
              var header;
              var b;
              var count;
              var _s;
              var p;
              var c;
              var s;
              var result;
              /** @type {number} */
              var start = pos;
              /** @type {!Int32Array} */
              var x = new Int32Array(16);
              /** @type {!Int32Array} */
              var map = new Int32Array(16);
              /** @type {!Int32Array} */
              result = new Int32Array(val);
              /** @type {number} */
              j = 0;
              for (; j < val; j++) {
                x[keys[j]]++;
              }
              /** @type {number} */
              map[1] = 0;
              /** @type {number} */
              i = 1;
              for (; i < h; i++) {
                /** @type {number} */
                map[i + 1] = map[i] + x[i];
              }
              /** @type {number} */
              j = 0;
              for (; j < val; j++) {
                if (0 !== keys[j]) {
                  /** @type {number} */
                  result[map[keys[j]]++] = j;
                }
              }
              if (p = n, c = 1 << p, s = c, 1 === map[h]) {
                /** @type {number} */
                header = 0;
                for (; header < s; ++header) {
                  data[pos + header] = new Node(0, 65535 & result[0]);
                }
                return s;
              }
              /** @type {number} */
              header = 0;
              /** @type {number} */
              j = 0;
              /** @type {number} */
              i = 1;
              /** @type {number} */
              b = 2;
              for (; i <= n; ++i, b = b << 1) {
                for (; x[i] > 0; --x[i]) {
                  type = new Node(255 & i, 65535 & result[j++]);
                  format(data, pos + header, b, c, type);
                  header = $(header, i);
                }
              }
              /** @type {number} */
              _s = s - 1;
              /** @type {number} */
              count = -1;
              i = n + 1;
              /** @type {number} */
              b = 2;
              for (; i <= h; ++i, b = b << 1) {
                for (; x[i] > 0; --x[i]) {
                  if ((header & _s) !== count) {
                    pos = pos + c;
                    p = g(x, i, n);
                    /** @type {number} */
                    c = 1 << p;
                    /** @type {number} */
                    s = s + c;
                    /** @type {number} */
                    count = header & _s;
                    data[start + count] = new Node(p + n & 255, pos - start - count & 65535);
                  }
                  type = new Node(i - n & 255, 65535 & result[j++]);
                  format(data, pos + (header >> n), b, c, type);
                  header = $(header, i);
                }
              }
              return s;
            };
          },
          "dec/prefix.js" : function(cond, t, xgh2) {
            /**
             * @param {number} _arg
             * @param {number} cb
             * @return {undefined}
             */
            function random_prime(_arg, cb) {
              /** @type {number} */
              this.offset = _arg;
              /** @type {number} */
              this.nbits = cb;
            }
            /** @type {!Array} */
            xgh2.kBlockLengthPrefixCode = [new random_prime(1, 2), new random_prime(5, 2), new random_prime(9, 2), new random_prime(13, 2), new random_prime(17, 3), new random_prime(25, 3), new random_prime(33, 3), new random_prime(41, 3), new random_prime(49, 4), new random_prime(65, 4), new random_prime(81, 4), new random_prime(97, 4), new random_prime(113, 5), new random_prime(145, 5), new random_prime(177, 5), new random_prime(209, 5), new random_prime(241, 6), new random_prime(305, 6), new random_prime(369, 
            7), new random_prime(497, 8), new random_prime(753, 9), new random_prime(1265, 10), new random_prime(2289, 11), new random_prime(4337, 12), new random_prime(8433, 13), new random_prime(16625, 24)];
            /** @type {!Array} */
            xgh2.kInsertLengthPrefixCode = [new random_prime(0, 0), new random_prime(1, 0), new random_prime(2, 0), new random_prime(3, 0), new random_prime(4, 0), new random_prime(5, 0), new random_prime(6, 1), new random_prime(8, 1), new random_prime(10, 2), new random_prime(14, 2), new random_prime(18, 3), new random_prime(26, 3), new random_prime(34, 4), new random_prime(50, 4), new random_prime(66, 5), new random_prime(98, 5), new random_prime(130, 6), new random_prime(194, 7), new random_prime(322, 
            8), new random_prime(578, 9), new random_prime(1090, 10), new random_prime(2114, 12), new random_prime(6210, 14), new random_prime(22594, 24)];
            /** @type {!Array} */
            xgh2.kCopyLengthPrefixCode = [new random_prime(2, 0), new random_prime(3, 0), new random_prime(4, 0), new random_prime(5, 0), new random_prime(6, 0), new random_prime(7, 0), new random_prime(8, 0), new random_prime(9, 0), new random_prime(10, 1), new random_prime(12, 1), new random_prime(14, 2), new random_prime(18, 2), new random_prime(22, 3), new random_prime(30, 3), new random_prime(38, 4), new random_prime(54, 4), new random_prime(70, 5), new random_prime(102, 5), new random_prime(134, 
            6), new random_prime(198, 7), new random_prime(326, 8), new random_prime(582, 9), new random_prime(1094, 10), new random_prime(2118, 24)];
            /** @type {!Array} */
            xgh2.kInsertRangeLut = [0, 0, 8, 8, 0, 16, 8, 16, 16];
            /** @type {!Array} */
            xgh2.kCopyRangeLut = [0, 8, 0, 8, 16, 0, 16, 8, 16];
          },
          "dec/streams.js" : function(cond, thencommands, elsecommands) {
            /**
             * @param {string} extendedBuffer
             * @return {undefined}
             */
            function SocketImplMock(extendedBuffer) {
              /** @type {string} */
              this.buffer = extendedBuffer;
              /** @type {number} */
              this.pos = 0;
            }
            /**
             * @param {string} template
             * @return {undefined}
             */
            function render(template) {
              /** @type {string} */
              this.buffer = template;
              /** @type {number} */
              this.pos = 0;
            }
            /**
             * @param {!Object} bytes
             * @param {number} position
             * @param {number} size
             * @return {?}
             */
            SocketImplMock.prototype.read = function(bytes, position, size) {
              if (this.pos + size > this.buffer.length) {
                /** @type {number} */
                size = this.buffer.length - this.pos;
              }
              /** @type {number} */
              var i = 0;
              for (; i < size; i++) {
                bytes[position + i] = this.buffer[this.pos + i];
              }
              return this.pos += size, size;
            };
            /** @type {function(string): undefined} */
            elsecommands.BrotliInput = SocketImplMock;
            /**
             * @param {!Object} buffer
             * @param {number} size
             * @return {?}
             */
            render.prototype.write = function(buffer, size) {
              if (this.pos + size > this.buffer.length) {
                throw new Error("Output buffer is not large enough");
              }
              return this.buffer.set(buffer.subarray(0, size), this.pos), this.pos += size, size;
            };
            /** @type {function(string): undefined} */
            elsecommands.BrotliOutput = render;
          },
          "dec/transform.js" : function(words, text, metrics) {
            /**
             * @param {string} name
             * @param {!Array} handler
             * @param {string} data
             * @return {undefined}
             */
            function ExCommand(name, handler, data) {
              /** @type {!Uint8Array} */
              this.prefix = new Uint8Array(name.length);
              /** @type {!Array} */
              this.transform = handler;
              /** @type {!Uint8Array} */
              this.suffix = new Uint8Array(data.length);
              /** @type {number} */
              var i = 0;
              for (; i < name.length; i++) {
                this.prefix[i] = name.charCodeAt(i);
              }
              /** @type {number} */
              i = 0;
              for (; i < data.length; i++) {
                this.suffix[i] = data.charCodeAt(i);
              }
            }
            /**
             * @param {!Object} obj
             * @param {number} key
             * @return {?}
             */
            function _has(obj, key) {
              return obj[key] < 192 ? (obj[key] >= 97 && obj[key] <= 122 && (obj[key] ^= 32), 1) : obj[key] < 224 ? (obj[key + 1] ^= 32, 2) : (obj[key + 2] ^= 5, 3);
            }
            var self = words("./dictionary");
            const chd = 0;
            const una = 1;
            const unm = 2;
            const wqs = 3;
            const u = 4;
            const $default = 5;
            const ya = 6;
            const sor = 7;
            const ab = 8;
            const s = 9;
            const g = 10;
            const r = 11;
            const postersPerRow = 12;
            const sushi = 13;
            const ma = 14;
            const cd = 15;
            const ve = 16;
            const marks = 17;
            const shortName = 18;
            const wq = 20;
            /** @type {!Array} */
            var data = [new ExCommand("", chd, ""), new ExCommand("", chd, " "), new ExCommand(" ", chd, " "), new ExCommand("", postersPerRow, ""), new ExCommand("", g, " "), new ExCommand("", chd, " the "), new ExCommand(" ", chd, ""), new ExCommand("s ", chd, " "), new ExCommand("", chd, " of "), new ExCommand("", g, ""), new ExCommand("", chd, " and "), new ExCommand("", sushi, ""), new ExCommand("", una, ""), new ExCommand(", ", chd, " "), new ExCommand("", chd, ", "), new ExCommand(" ", g, 
            " "), new ExCommand("", chd, " in "), new ExCommand("", chd, " to "), new ExCommand("e ", chd, " "), new ExCommand("", chd, '"'), new ExCommand("", chd, "."), new ExCommand("", chd, '">'), new ExCommand("", chd, "\n"), new ExCommand("", wqs, ""), new ExCommand("", chd, "]"), new ExCommand("", chd, " for "), new ExCommand("", ma, ""), new ExCommand("", unm, ""), new ExCommand("", chd, " a "), new ExCommand("", chd, " that "), new ExCommand(" ", g, ""), new ExCommand("", chd, ". "), new ExCommand(".", 
            chd, ""), new ExCommand(" ", chd, ", "), new ExCommand("", cd, ""), new ExCommand("", chd, " with "), new ExCommand("", chd, "'"), new ExCommand("", chd, " from "), new ExCommand("", chd, " by "), new ExCommand("", ve, ""), new ExCommand("", marks, ""), new ExCommand(" the ", chd, ""), new ExCommand("", u, ""), new ExCommand("", chd, ". The "), new ExCommand("", r, ""), new ExCommand("", chd, " on "), new ExCommand("", chd, " as "), new ExCommand("", chd, " is "), new ExCommand("", sor, 
            ""), new ExCommand("", una, "ing "), new ExCommand("", chd, "\n\t"), new ExCommand("", chd, ":"), new ExCommand(" ", chd, ". "), new ExCommand("", chd, "ed "), new ExCommand("", wq, ""), new ExCommand("", shortName, ""), new ExCommand("", ya, ""), new ExCommand("", chd, "("), new ExCommand("", g, ", "), new ExCommand("", ab, ""), new ExCommand("", chd, " at "), new ExCommand("", chd, "ly "), new ExCommand(" the ", chd, " of "), new ExCommand("", $default, ""), new ExCommand("", s, ""), 
            new ExCommand(" ", g, ", "), new ExCommand("", g, '"'), new ExCommand(".", chd, "("), new ExCommand("", r, " "), new ExCommand("", g, '">'), new ExCommand("", chd, '="'), new ExCommand(" ", chd, "."), new ExCommand(".com/", chd, ""), new ExCommand(" the ", chd, " of the "), new ExCommand("", g, "'"), new ExCommand("", chd, ". This "), new ExCommand("", chd, ","), new ExCommand(".", chd, " "), new ExCommand("", g, "("), new ExCommand("", g, "."), new ExCommand("", chd, " not "), new ExCommand(" ", 
            chd, '="'), new ExCommand("", chd, "er "), new ExCommand(" ", r, " "), new ExCommand("", chd, "al "), new ExCommand(" ", r, ""), new ExCommand("", chd, "='"), new ExCommand("", r, '"'), new ExCommand("", g, ". "), new ExCommand(" ", chd, "("), new ExCommand("", chd, "ful "), new ExCommand(" ", g, ". "), new ExCommand("", chd, "ive "), new ExCommand("", chd, "less "), new ExCommand("", r, "'"), new ExCommand("", chd, "est "), new ExCommand(" ", g, "."), new ExCommand("", r, '">'), new ExCommand(" ", 
            chd, "='"), new ExCommand("", g, ","), new ExCommand("", chd, "ize "), new ExCommand("", r, "."), new ExCommand("\u00c2\u00a0", chd, ""), new ExCommand(" ", chd, ","), new ExCommand("", g, '="'), new ExCommand("", r, '="'), new ExCommand("", chd, "ous "), new ExCommand("", r, ", "), new ExCommand("", g, "='"), new ExCommand(" ", g, ","), new ExCommand(" ", r, '="'), new ExCommand(" ", r, ", "), new ExCommand("", r, ","), new ExCommand("", r, "("), new ExCommand("", r, ". "), new ExCommand(" ", 
            r, "."), new ExCommand("", r, "='"), new ExCommand(" ", r, ". "), new ExCommand(" ", g, '="'), new ExCommand(" ", r, "='"), new ExCommand(" ", g, "='")];
            /** @type {!Array} */
            metrics.kTransforms = data;
            /** @type {number} */
            metrics.kNumTransforms = data.length;
            /**
             * @param {!Object} data
             * @param {number} t
             * @param {number} name
             * @param {number} n
             * @param {number} index
             * @return {?}
             */
            metrics.transformDictionaryWord = function(data, t, name, n, index) {
              var x;
              var str = data[index].prefix;
              var selector = data[index].suffix;
              var max = data[index].transform;
              /** @type {number} */
              var i = max < postersPerRow ? 0 : max - 11;
              /** @type {number} */
              var j = 0;
              /** @type {number} */
              var tmp = t;
              if (i > n) {
                /** @type {number} */
                i = n;
              }
              /** @type {number} */
              var idx = 0;
              for (; idx < str.length;) {
                data[t++] = str[idx++];
              }
              name = name + i;
              /** @type {number} */
              n = n - i;
              if (max <= s) {
                /** @type {number} */
                n = n - max;
              }
              /** @type {number} */
              j = 0;
              for (; j < n; j++) {
                data[t++] = self.dictionary[name + j];
              }
              if (x = t - n, max === g) {
                _has(data, x);
              } else {
                if (max === r) {
                  for (; n > 0;) {
                    var i = _has(data, x);
                    x = x + i;
                    /** @type {number} */
                    n = n - i;
                  }
                }
              }
              /** @type {number} */
              var endIndex = 0;
              for (; endIndex < selector.length;) {
                data[t++] = selector[endIndex++];
              }
              return t - tmp;
            };
          },
          "node_modules/base64-js/index.js" : function(someChunks, module, exports) {
            /**
             * @param {string} e
             * @return {?}
             */
            function split(e) {
              var k = e.length;
              if (k % 4 > 0) {
                throw new Error("Invalid string. Length must be a multiple of 4");
              }
              return "=" === e[k - 2] ? 2 : "=" === e[k - 1] ? 1 : 0;
            }
            /**
             * @param {string} data
             * @return {?}
             */
            function byteLength(data) {
              return 3 * data.length / 4 - split(data);
            }
            /**
             * @param {string} s
             * @return {?}
             */
            function toByteArray(s) {
              var q;
              var b;
              var t;
              var LIMB_BITMASK;
              var faceDir;
              var callbackVals;
              var i = s.length;
              faceDir = split(s);
              callbackVals = new Arr(3 * i / 4 - faceDir);
              t = faceDir > 0 ? i - 4 : i;
              /** @type {number} */
              var callbackCount = 0;
              /** @type {number} */
              q = 0;
              /** @type {number} */
              b = 0;
              for (; q < t; q = q + 4, b = b + 3) {
                /** @type {number} */
                LIMB_BITMASK = result[s.charCodeAt(q)] << 18 | result[s.charCodeAt(q + 1)] << 12 | result[s.charCodeAt(q + 2)] << 6 | result[s.charCodeAt(q + 3)];
                /** @type {number} */
                callbackVals[callbackCount++] = LIMB_BITMASK >> 16 & 255;
                /** @type {number} */
                callbackVals[callbackCount++] = LIMB_BITMASK >> 8 & 255;
                /** @type {number} */
                callbackVals[callbackCount++] = 255 & LIMB_BITMASK;
              }
              return 2 === faceDir ? (LIMB_BITMASK = result[s.charCodeAt(q)] << 2 | result[s.charCodeAt(q + 1)] >> 4, callbackVals[callbackCount++] = 255 & LIMB_BITMASK) : 1 === faceDir && (LIMB_BITMASK = result[s.charCodeAt(q)] << 10 | result[s.charCodeAt(q + 1)] << 4 | result[s.charCodeAt(q + 2)] >> 2, callbackVals[callbackCount++] = LIMB_BITMASK >> 8 & 255, callbackVals[callbackCount++] = 255 & LIMB_BITMASK), callbackVals;
            }
            /**
             * @param {number} num
             * @return {?}
             */
            function tripletToBase64(num) {
              return lookup[num >> 18 & 63] + lookup[num >> 12 & 63] + lookup[num >> 6 & 63] + lookup[63 & num];
            }
            /**
             * @param {!Function} uint8
             * @param {number} start
             * @param {number} end
             * @return {?}
             */
            function encodeChunk(uint8, start, end) {
              var temp;
              /** @type {!Array} */
              var output = [];
              /** @type {number} */
              var i = start;
              for (; i < end; i = i + 3) {
                temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + uint8[i + 2];
                output.push(tripletToBase64(temp));
              }
              return output.join("");
            }
            /**
             * @param {!Object} uint8
             * @return {?}
             */
            function fromByteArray(uint8) {
              var tmp;
              var len = uint8.length;
              /** @type {number} */
              var extraBytes = len % 3;
              /** @type {string} */
              var output = "";
              /** @type {!Array} */
              var parts = [];
              /** @type {number} */
              var maxChunkLength = 16383;
              /** @type {number} */
              var i = 0;
              /** @type {number} */
              var len2 = len - extraBytes;
              for (; i < len2; i = i + maxChunkLength) {
                parts.push(encodeChunk(uint8, i, i + maxChunkLength > len2 ? len2 : i + maxChunkLength));
              }
              return 1 === extraBytes ? (tmp = uint8[len - 1], output = output + lookup[tmp >> 2], output = output + lookup[tmp << 4 & 63], output = output + "==") : 2 === extraBytes && (tmp = (uint8[len - 2] << 8) + uint8[len - 1], output = output + lookup[tmp >> 10], output = output + lookup[tmp >> 4 & 63], output = output + lookup[tmp << 2 & 63], output = output + "="), parts.push(output), parts.join("");
            }
            /** @type {function(string): ?} */
            exports.byteLength = byteLength;
            /** @type {function(string): ?} */
            exports.toByteArray = toByteArray;
            /** @type {function(!Object): ?} */
            exports.fromByteArray = fromByteArray;
            /** @type {!Array} */
            var lookup = [];
            /** @type {!Array} */
            var result = [];
            /** @type {!Function} */
            var Arr = "undefined" != typeof Uint8Array ? Uint8Array : Array;
            /** @type {string} */
            var code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            /** @type {number} */
            var i = 0;
            /** @type {number} */
            var len = code.length;
            for (; i < len; ++i) {
              lookup[i] = code[i];
              /** @type {number} */
              result[code.charCodeAt(i)] = i;
            }
            /** @type {number} */
            result["-".charCodeAt(0)] = 62;
            /** @type {number} */
            result["_".charCodeAt(0)] = 63;
          }
        };
        var key;
        for (key in values) {
          /** @type {string} */
          values[key].folder = key.substring(0, key.lastIndexOf("/") + 1);
        }
        /**
         * @param {string} x
         * @return {?}
         */
        var resolve = function(x) {
          /** @type {!Array} */
          var r = [];
          return x = x.split("/").every(function(str) {
            return ".." == str ? r.pop() : "." == str || "" == str || r.push(str);
          }) ? r.join("/") : null, x ? values[x] || values[x + ".js"] || values[x + "/index.js"] : null;
        };
        /**
         * @param {!Object} self
         * @param {string} path
         * @return {?}
         */
        var write = function(self, path) {
          return self ? resolve(self.folder + "node_modules/" + path) || write(self.parent, path) : null;
        };
        /**
         * @param {!Object} type
         * @param {string} value
         * @return {?}
         */
        var build = function(type, value) {
          var f = value.match(/^\//) ? null : type ? value.match(/^\.\.?\//) ? resolve(type.folder + value) : write(type, value) : resolve(value);
          if (!f) {
            throw "module not found: " + value;
          }
          return f.exports || (f.parent = type, f(build.bind(null, f), f, f.exports = {})), f.exports;
        };
        return build(null, callback);
      },
      decompress : function(type) {
        if (!this.exports) {
          this.exports = this.require("decompress.js");
        }
        try {
          return this.exports(type);
        } catch (e) {
        }
      },
      hasUnityMarker : function(src) {
        /** @type {string} */
        var expRecords = "UnityWeb Compressed Content (brotli)";
        if (!src.length) {
          return false;
        }
        /** @type {number} */
        var length = 1 & src[0] ? 14 & src[0] ? 4 : 7 : 1;
        /** @type {number} */
        var n = src[0] & (1 << length) - 1;
        /** @type {number} */
        var o = 1 + (Math.log(expRecords.length - 1) / Math.log(2) >> 3);
        if (commentOffset = length + 1 + 2 + 1 + 2 + (o << 3) + 7 >> 3, 17 == n || commentOffset > src.length) {
          return false;
        }
        /** @type {number} */
        var nn = n + (6 + (o << 4) + (expRecords.length - 1 << 6) << length);
        /** @type {number} */
        var prop = 0;
        for (; prop < commentOffset; prop++, nn = nn >>> 8) {
          if (src[prop] != (255 & nn)) {
            return false;
          }
        }
        return String.fromCharCode.apply(null, src.subarray(commentOffset, commentOffset + expRecords.length)) == expRecords;
      }
    },
    decompress : function(compressed, callback) {
      var self = this.gzip.hasUnityMarker(compressed) ? this.gzip : this.brotli.hasUnityMarker(compressed) ? this.brotli : this.identity;
      if (this.serverSetupWarningEnabled && self != this.identity && (console.log("You can reduce your startup time if you configure your web server to host .unityweb files using " + (self == this.gzip ? "gzip" : "brotli") + " compression."), this.serverSetupWarningEnabled = false), "function" != typeof callback) {
        return self.decompress(compressed);
      }
      if (!self.worker) {
        /** @type {string} */
        var src = URL.createObjectURL(new Blob(["this.require = ", self.require.toString(), "; this.decompress = ", self.decompress.toString(), "; this.onmessage = ", function(f) {
          var result = {
            id : f.data.id,
            decompressed : this.decompress(f.data.compressed)
          };
          postMessage(result, result.decompressed ? [result.decompressed.buffer] : []);
        }.toString(), "; postMessage({ ready: true });"], {
          type : "text/javascript"
        }));
        /** @type {!Worker} */
        self.worker = new Worker(src);
        /**
         * @param {!Object} data
         * @return {?}
         */
        self.worker.onmessage = function(data) {
          return data.data.ready ? void URL.revokeObjectURL(src) : (this.callbacks[data.data.id](data.data.decompressed), void delete this.callbacks[data.data.id]);
        };
        self.worker.callbacks = {};
        /** @type {number} */
        self.worker.nextCallbackId = 0;
      }
      /** @type {number} */
      var callbackId = self.worker.nextCallbackId++;
      /** @type {!Function} */
      self.worker.callbacks[callbackId] = callback;
      self.worker.postMessage({
        id : callbackId,
        compressed : compressed
      }, [compressed.buffer]);
    },
    serverSetupWarningEnabled : true
  }
};
