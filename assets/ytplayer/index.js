
var EventEmitter = function () {
  this.events = {};
};

EventEmitter.prototype.on = function (event, listener) {
  if (typeof this.events[event] !== 'object') {
      this.events[event] = [];
  }

  this.events[event].push(listener);
};

EventEmitter.prototype.removeListener = function (event, listener) {
  var idx;

  if (typeof this.events[event] === 'object') {
      idx = this.indexOf(this.events[event], listener);

      if (idx > -1) {
          this.events[event].splice(idx, 1);
      }
  }
};

EventEmitter.prototype.emit = function (event) {
  var i, listeners, length, args = [].slice.call(arguments, 1);

  if (typeof this.events[event] === 'object') {
      listeners = this.events[event].slice();
      length = listeners.length;

      for (i = 0; i < length; i++) {
          listeners[i].apply(this, args);
      }
  }
};

EventEmitter.prototype.once = function (event, listener) {
  this.on(event, function g () {
      this.removeListener(event, g);
      listener.apply(this, arguments);
  });
};

var loadScript = function (src, attrs, parentNode) {
  return new Promise((resolve, reject) => {
    var script = document.createElement('script')
    script.async = true
    script.src = src

    for (var [k, v] of Object.entries(attrs || {})) {
      script.setAttribute(k, v)
    }

    script.onload = () => {
      script.onerror = script.onload = null
      resolve(script)
    }

    script.onerror = () => {
      script.onerror = script.onload = null
      reject(new Error(`Failed to load ${src}`))
    }

    var node = parentNode || document.head || document.getElementsByTagName('head')[0]
    node.appendChild(script)
  })
}

var YOUTUBE_IFRAME_API_SRC = 'https://www.youtube.com/iframe_api'

var YOUTUBE_STATES = {
  '-1': 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued'
}

var YOUTUBE_ERROR = {
 
  INVALID_PARAM: 2,

 
  HTML5_ERROR: 5,

  
  NOT_FOUND: 100,

  
  UNPLAYABLE_1: 101,

  
  UNPLAYABLE_2: 150
}

var loadIframeAPICallbacks = []


 * @param {HTMLElement|selector} element

 YouTubePlayer = class YouTubePlayer extends EventEmitter {
  constructor (element, opts) {
    super()

    var elem = typeof element === 'string'
      ? document.querySelector(element)
      : element
      
    if (elem.id) {
      this._id = elem.id // use existing element id
    } else {
      this._id = elem.id = 'ytplayer-' + Math.random().toString(16).slice(2, 8)
    }

    this._opts = Object.assign({
      width: 640,
      height: 360,
      autoplay: false,
      captions: undefined,
      controls: true,
      keyboard: true,
      fullscreen: true,
      annotations: true,
      modestBranding: false,
      related: true,
      timeupdateFrequency: 1000,
      playsInline: true,
      start: 0
    }, opts)

    this.videoId = null
    this.destroyed = false

    this._api = null
    this._autoplay = false // autoplay the first video?
    this._player = null
    this._ready = false // is player ready?
    this._queue = []
    this.replayInterval = []

    this._interval = null

    
    this._startInterval = this._startInterval.bind(this)
    this._stopInterval = this._stopInterval.bind(this)

    this.on('playing', this._startInterval)
    this.on('unstarted', this._stopInterval)
    this.on('ended', this._stopInterval)
    this.on('paused', this._stopInterval)
    this.on('buffering', this._stopInterval)

    this._loadIframeAPI((err, api) => {
      if (err) return this._destroy(new Error('YouTube Iframe API failed to load'))
      this._api = api

      
      if (this.videoId) this.load(this.videoId, this._autoplay, this._start)
    })
  }

  indexOf (haystack, needle) {
    var i = 0, length = haystack.length, idx = -1, found = false;

    while (i < length && !found) {
        if (haystack[i] === needle) {
            idx = i;
            found = true;
        }

        i++;
    }

    return idx;
  }

  load (videoId, autoplay = false, start = 0) {
    if (this.destroyed) return

    this._startOptimizeDisplayEvent()
    this._optimizeDisplayHandler('center, center')

    this.videoId = videoId
    this._autoplay = autoplay
    this._start = start

    
    if (!this._api) return

    if (!this._player) {
      this._createPlayer(videoId)
      return
    }

    
    if (!this._ready) return

    if (autoplay) {
      this._player.loadVideoById(videoId, start)
    } else {
      this._player.cueVideoById(videoId, start)
    }
  }

  play () {
    if (this._ready) this._player.playVideo()
    else this._queueCommand('play')
  }

  replayFrom(num) {
    const find = this.replayInterval.find((obj) => {
      return obj.iframeParent === this._player.i.parentNode
    })
    if (find || !num) return
    this.replayInterval.push({
      iframeParent: this._player.i.parentNode,
      interval: setInterval(() => {
        if (this._player.getCurrentTime() >= this._player.getDuration() - Number(num)) {
          this.seek(0);
          for (const [key, val] of this.replayInterval.entries()) {
            if (Object.hasOwnProperty.call(this.replayInterval, key)) {
              clearInterval(this.replayInterval[key].interval)
              this.replayInterval.splice(key, 1)
            }
          }
        }
      }, Number(num) * 1000)
    })
  }

  pause () {
    if (this._ready) this._player.pauseVideo()
    else this._queueCommand('pause')
  }

  stop () {
    if (this._ready) this._player.stopVideo()
    else this._queueCommand('stop')
  }

  seek (seconds) {
    if (this._ready) this._player.seekTo(seconds, true)
    else this._queueCommand('seek', seconds)
  }
  
  _optimizeDisplayHandler(anchor) {
    if (!this._player) return
    const YTPlayer = this._player.i
    const YTPAlign = anchor.split(",");
    if (YTPlayer) {
        const win = {}, 
          el = YTPlayer.parentElement;
        
          if (el) {
            const computedStyle = window.getComputedStyle(el), 
              outerHeight = el.clientHeight + parseFloat(computedStyle.marginTop, 10) + parseFloat(computedStyle.marginBottom, 10) + parseFloat(computedStyle.borderTopWidth, 10) + parseFloat(computedStyle.borderBottomWidth, 10),
              outerWidth = el.clientWidth + parseFloat(computedStyle.marginLeft, 10) + parseFloat(computedStyle.marginRight, 10) + parseFloat(computedStyle.borderLeftWidth, 10) + parseFloat(computedStyle.borderRightWidth, 10),
              ratio = 1.7,
              vid = YTPlayer;
            
            win.width = outerWidth;
            win.height = outerHeight + 80;

            vid.style.width = win.width + 'px';
            vid.style.height = Math.ceil(parseFloat(vid.style.width, 10) / ratio) + 'px';
            vid.style.marginTop = Math.ceil(-((parseFloat(vid.style.height, 10) - win.height) / 2)) + 'px';
            vid.style.marginLeft = 0;

            const lowest = parseFloat(vid.style.height, 10) < win.height;

            if (lowest) {
              vid.style.height = win.height + 'px',
              vid.style.width = Math.ceil(parseFloat(vid.style.height, 10) * ratio) + 'px',
              vid.style.marginTop = 0,
              vid.style.marginLeft = Math.ceil(-((parseFloat(vid.style.width, 10) - win.width) / 2)) + 'px' 
            }
            for (const align in YTPAlign)
                if (YTPAlign.hasOwnProperty(align)) {
                    const al = YTPAlign[align].replace(/ /g, "");
                    switch (al) {
                    case "top":
                        vid.style.marginTop = lowest ? -((parseFloat(vid.style.height, 10) - win.height) / 2) + 'px' : 0;
                        break;
                    case "bottom":
                        vid.style.marginTop = lowest ? 0 : -(parseFloat(vid.style.height, 10) - win.height) + 'px';
                        break;
                    case "left":
                        vid.style.marginLeft = 0;
                        break;
                    case "right":
                        vid.style.marginLeft = lowest ? -(parseFloat(vid.style.width, 10) - win.width) : 0 + 'px';
                        break;
                    default:
                      parseFloat(vid.style.width, 10) > win.width && (vid.style.marginLeft = -((parseFloat(vid.style.width, 10) - win.width) / 2) + 'px') 
                    }
                }
        }
    }
  }

  stopResize () {
    window.removeEventListener('resize', this._resizeListener)
    this._resizeListener = null
  }

  stopReplay (iframeParent) {
    for (const [key, val] of this.replayInterval.entries()) {
      if (Object.hasOwnProperty.call(this.replayInterval, key)) {
        if (iframeParent === this.replayInterval[key].iframeParent) {
          clearInterval(this.replayInterval[key].interval);
          this.replayInterval.splice(key, 1)
        }
      }
    }
  }

  setVolume (volume) {
    if (this._ready) this._player.setVolume(volume)
    else this._queueCommand('setVolume', volume)
  }

  loadPlaylist () {
    if (this._ready) this._player.loadPlaylist(this.videoId)
    else this._queueCommand('loadPlaylist', this.videoId)
  }

  setLoop (bool) {
    if (this._ready) this._player.setLoop(bool)
    else this._queueCommand('setLoop', bool)
  }

  getVolume () {
    return (this._ready && this._player.getVolume()) || 0
  }

  mute () {
    if (this._ready) this._player.mute()
    else this._queueCommand('mute')
  }

  unMute () {
    if (this._ready) this._player.unMute()
    else this._queueCommand('unMute')
  }

  isMuted () {
    return (this._ready && this._player.isMuted()) || false
  }

  setSize (width, height) {
    if (this._ready) this._player.setSize(width, height)
    else this._queueCommand('setSize', width, height)
  }

  setPlaybackRate (rate) {
    if (this._ready) this._player.setPlaybackRate(rate)
    else this._queueCommand('setPlaybackRate', rate)
  }

  setPlaybackQuality (suggestedQuality) {
    if (this._ready) this._player.setPlaybackQuality(suggestedQuality)
    else this._queueCommand('setPlaybackQuality', suggestedQuality)
  }

  getPlaybackRate () {
    return (this._ready && this._player.getPlaybackRate()) || 1
  }

  getAvailablePlaybackRates () {
    return (this._ready && this._player.getAvailablePlaybackRates()) || [1]
  }

  getDuration () {
    return (this._ready && this._player.getDuration()) || 0
  }

  getProgress () {
    return (this._ready && this._player.getVideoLoadedFraction()) || 0
  }

  getState () {
    return (this._ready && YOUTUBE_STATES[this._player.getPlayerState()]) || 'unstarted'
  }

  getCurrentTime () {
    return (this._ready && this._player.getCurrentTime()) || 0
  }

  destroy () {
    this._destroy()
  }

  _destroy (err) {
    if (this.destroyed) return
    this.destroyed = true

    if (this._player) {
      this._player.stopVideo && this._player.stopVideo()
      this._player.destroy()
    }

    this.videoId = null

    this._id = null
    this._opts = null
    this._api = null
    this._player = null
    this._ready = false
    this._queue = null

    this._stopInterval()

    this.removeListener('playing', this._startInterval)
    this.removeListener('paused', this._stopInterval)
    this.removeListener('buffering', this._stopInterval)
    this.removeListener('unstarted', this._stopInterval)
    this.removeListener('ended', this._stopInterval)

    if (err) this.emit('error', err)
  }

  _queueCommand (command, ...args) {
    if (this.destroyed) return
    this._queue.push([command, args])
  }

  _flushQueue () {
    while (this._queue.length) {
      var command = this._queue.shift()
      this[command[0]].apply(this, command[1])
    }
  }

  _loadIframeAPI (cb) {
    // If API is loaded, there is nothing else to do
    if (window.YT && typeof window.YT.Player === 'function') {
      return cb(null, window.YT)
    }

    
    loadIframeAPICallbacks.push(cb)

    var scripts = Array.from(document.getElementsByTagName('script'))
    var isLoading = scripts.some(script => script.src === YOUTUBE_IFRAME_API_SRC)

    
    if (!isLoading) {
      loadScript(YOUTUBE_IFRAME_API_SRC).catch(err => {
        while (loadIframeAPICallbacks.length) {
          var loadCb = loadIframeAPICallbacks.shift()
          loadCb(err)
        }
      })
    }

    var prevOnYouTubeIframeAPIReady = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prevOnYouTubeIframeAPIReady === 'function') {
        prevOnYouTubeIframeAPIReady()
      }
      while (loadIframeAPICallbacks.length) {
        var loadCb = loadIframeAPICallbacks.shift()
        loadCb(null, window.YT)
      }
    }
  }

  _createPlayer (videoId) {
    if (this.destroyed) return

    var opts = this._opts

    this._player = new this._api.Player(this._id, {
      width: opts.width,
      height: opts.height,
      videoId: videoId,

      
      host: opts.host,

      playerVars: {
        
        autoplay: opts.autoplay ? 1 : 0,

        mute: opts.mute ? 1 : 0,

        
        hl: (opts.captions != null && opts.captions !== false)
          ? opts.captions
          : undefined, 

        
        cc_lang_pref: (opts.captions != null && opts.captions !== false)
          ? opts.captions
          : undefined, 

        
        controls: opts.controls ? 2 : 0,

        
        enablejsapi: 1,

        
        allowfullscreen: true,

        
        iv_load_policy: opts.annotations ? 1 : 3,

        
        modestbranding: opts.modestBranding ? 1 : 0,

        
        origin: '*',

        
        rel: opts.related ? 1 : 0,

        
        mode: 'transparent',
        showinfo: 0,
        html5: 1,
        version: 3,
        playerapiid: 'iframe_YTP_1624972482514'
        
      },
      events: {
        onReady: () => this._onReady(videoId),
        onStateChange: (data) => this._onStateChange(data),
        onPlaybackQualityChange: (data) => this._onPlaybackQualityChange(data),
        onPlaybackRateChange: (data) => this._onPlaybackRateChange(data),
        onError: (data) => this._onError(data)
      }
    })
  }

  
  _onReady (videoId) {
    if (this.destroyed) return
    
    this._ready = true

    
    this.load(this.videoId, this._autoplay, this._start)

    this._flushQueue()
  }

  
  _onStateChange (data) {
    if (this.destroyed) return

    var state = YOUTUBE_STATES[data.data]

    if (state) {
      
      if (['paused', 'buffering', 'ended'].includes(state)) this._onTimeupdate()

      this.emit(state)

      if (['unstarted', 'playing', 'cued'].includes(state)) this._onTimeupdate()
    } else {
      throw new Error('Unrecognized state change: ' + data)
    }
  }

  
  _onPlaybackQualityChange (data) {
    if (this.destroyed) return
    this.emit('playbackQualityChange', data.data)
  }

  
  _onPlaybackRateChange (data) {
    if (this.destroyed) return
    this.emit('playbackRateChange', data.data)
  }

  
  _onError (data) {
    if (this.destroyed) return

    var code = data.data

    
    if (code === YOUTUBE_ERROR.HTML5_ERROR) return

    
    if (code === YOUTUBE_ERROR.UNPLAYABLE_1 ||
        code === YOUTUBE_ERROR.UNPLAYABLE_2 ||
        code === YOUTUBE_ERROR.NOT_FOUND ||
        code === YOUTUBE_ERROR.INVALID_PARAM) {
      return this.emit('unplayable', this.videoId)
    }

    
    this._destroy(new Error('YouTube Player Error. Unknown error code: ' + code))
  }

  _startOptimizeDisplayEvent () {
    if (this._resizeListener) return;
    this._resizeListener = () => this._optimizeDisplayHandler('center, center')
    window.addEventListener('resize', this._resizeListener);
  }

  
  _onTimeupdate () {
    this.emit('timeupdate', this.getCurrentTime())
  }

  _startInterval () {
    this._interval = setInterval(() => this._onTimeupdate(), this._opts.timeupdateFrequency)
  }

  _stopInterval () {
    clearInterval(this._interval)
    this._interval = null
  }
}


