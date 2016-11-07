"use strict";
window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

var Recorder = function (config, existingStream, levelMeterCallback) {

    var that = this;

    if (!Recorder.isRecordingSupported()) {
        throw "Recording is not supported in this browser";
    }

    this.config = config = config || {};
    this.config.command = "init";
    this.config.bufferLength = config.bufferLength || 4096;
    this.config.inputGain = config.inputGain || 1.0;
    this.config.monitorGain = config.monitorGain || 0;
    this.config.numberOfChannels = config.numberOfChannels || 1;
    this.config.originalSampleRate = this.audioContext.sampleRate;
    this.config.encoderSampleRate = config.encoderSampleRate || 48000;
    this.config.encoderPath = config.encoderPath || 'encoderWorker.min.js';
    this.config.streamPages = config.streamPages || false;
    this.config.leaveStreamOpen = config.leaveStreamOpen || false;
    this.config.maxBuffersPerPage = config.maxBuffersPerPage || 40;
    this.config.encoderApplication = config.encoderApplication || 2049;
    this.config.encoderFrameSize = config.encoderFrameSize || 20;
    this.config.resampleQuality = config.resampleQuality || 3;
    this.config.streamOptions = config.streamOptions || {
            optional: [],
            mandatory: {
                googEchoCancellation: false,
                googAutoGainControl: false,
                googNoiseSuppression: false,
                googHighpassFilter: false
            }
        };

    // MOD (can't be part of the config because it is later used in a postmessage which can't include an object like this)
    this.stream = existingStream;
    this.streamPassed = true;

    this.state = "inactive";
    this.eventTarget = document.createDocumentFragment();

    // 1. An input gain the we make the very first node after the source node
    this.inputGain = this.audioContext.createGain();
    this.setInputGain(this.config.inputGain);

    // 2. (first branch) ScriptProcessor for ogg-opus encoding
    this.scriptProcessorNode = this.audioContext.createScriptProcessor(this.config.bufferLength,
        this.config.numberOfChannels, this.config.numberOfChannels);
    this.scriptProcessorNode.onaudioprocess = function (e) {
        that.encodeBuffers(e.inputBuffer);
    };

    // 3. (second branch) A monitor gain to listen to myself during recording
    this.monitorNode = this.audioContext.createGain();
    this.setMonitorGain(this.config.monitorGain);

    // 4. (third branch) Additional node and its helper for analyzing audio input level
    this.levelMeterCallback = levelMeterCallback;

    // Helper for the level meter
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.smoothingTimeConstant = 0.3;
    this.analyser.fftSize = 1024;

    // ScriptProcessor for the level meter
    this.levelMeterNode = this.audioContext.createScriptProcessor(2048, 1, 1);
    this.levelMeterNode.onaudioprocess = function () {

        if (that.state === "recording") {

            // get the average for the first channel
            var array =  new Uint8Array(that.analyser.frequencyBinCount);
            that.analyser.getByteFrequencyData(array);
            var average = getAverageVolume(array);

            //console.log("Average: " + average);
            that.levelMeterCallback(average);
        }
    };

    var getAverageVolume = function(array) {
        var values = 0;
        var average;

        var length = array.length;

        // get all the frequency amplitudes
        for (var i = 0; i < length; i++) {
            values += array[i];
        }

        average = values / length;
        return average;
    };
};

Recorder.isRecordingSupported = function () {
    return window.AudioContext && navigator.getUserMedia;
};

Recorder.prototype.addEventListener = function (type, listener, useCapture) {
    this.eventTarget.addEventListener(type, listener, useCapture);
};

// MOD: Set streamPages on and off when required
Recorder.prototype.enableStreamPages = function (enable) {
    if(this.state === "inactive") {
        this.config.streamPages = enable;
    }
};

Recorder.prototype.audioContext = new window.AudioContext();

Recorder.prototype.clearStream = function () {
    if (this.stream) {

        if (this.stream.getTracks) {
            this.stream.getTracks().forEach(function (track) {
                track.stop();
            });
        }

        else {
            this.stream.stop();
        }

        delete this.stream;
    }
};

Recorder.prototype.encodeBuffers = function (inputBuffer) {
    if (this.state === "recording") {
        var buffers = [];
        for (var i = 0; i < inputBuffer.numberOfChannels; i++) {
            buffers[i] = inputBuffer.getChannelData(i);
        }

        this.encoder.postMessage({
            command: "encode",
            buffers: buffers
        });
    }
};

Recorder.prototype.initStream = function () {
    if (this.stream && !this.streamPassed) { // MOD
        this.eventTarget.dispatchEvent(new Event("streamReady"));
        return;
    }

    // MOD: Init remaining parts of the passed stream but don't call getUserMedia again
    if (this.streamPassed) {
        this.connectAudioGraph(this.stream);
        this.eventTarget.dispatchEvent(new Event("streamReady"));
        this.streamPassed = false;
        return;
    }

    // This is now only used when no stream is passed to the constructor
    var that = this;
    navigator.getUserMedia(
        {audio: this.config.streamOptions},
        function (stream) {
            that.stream = stream;
            that.connectAudioGraph(stream);
            /*
            that.sourceNode = that.audioContext.createMediaStreamSource(stream);
            that.sourceNode.connect(that.scriptProcessorNode);
            that.sourceNode.connect(that.monitorNode);
            */
            that.eventTarget.dispatchEvent(new Event("streamReady"));
        },
        function (e) {
            that.eventTarget.dispatchEvent(new ErrorEvent("streamError", {error: e}));
        }
    );
};

Recorder.prototype.connectAudioGraph = function(stream) {
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.inputGain);

    this.inputGain.connect(this.scriptProcessorNode);
    this.inputGain.connect(this.monitorNode);

    this.inputGain.connect(this.analyser);
    this.analyser.connect(this.levelMeterNode);
};

Recorder.prototype.pause = function () {
    if (this.state === "recording") {
        this.state = "paused";
        this.eventTarget.dispatchEvent(new Event('pause'));
    }
};

Recorder.prototype.removeEventListener = function (type, listener, useCapture) {
    this.eventTarget.removeEventListener(type, listener, useCapture);
};

Recorder.prototype.resume = function () {
    if (this.state === "paused") {
        this.state = "recording";
        this.eventTarget.dispatchEvent(new Event('resume'));
    }
};

Recorder.prototype.setMonitorGain = function (gain) {
    this.monitorNode.gain.value = gain;
};

// NEW
Recorder.prototype.setInputGain = function (gain) {
    this.inputGain.gain.value = gain;
};

// NEW
Recorder.prototype.getInputGain = function () {
    return this.inputGain.gain.value;
};

Recorder.prototype.start = function () {
    if (this.state === "inactive" && this.stream) {
        var that = this;
        this.encoder = new Worker(this.config.encoderPath);

        if (this.config.streamPages) {
            this.encoder.addEventListener("message", function (e) {
                that.streamPage(e.data);
            });
        }

        else {
            this.recordedPages = [];
            this.totalLength = 0;
            this.encoder.addEventListener("message", function (e) {
                that.storePage(e.data);
            });
        }

        // First buffer can contain old data. Don't encode it.
        this.encodeBuffers = function () {
            delete this.encodeBuffers;
        };

        this.state = "recording";
        this.monitorNode.connect(this.audioContext.destination);
        this.scriptProcessorNode.connect(this.audioContext.destination);

        // MOD NEW
        this.levelMeterNode.connect(this.audioContext.destination);

        this.eventTarget.dispatchEvent(new Event('start'));
        this.encoder.postMessage(this.config);
    }
};

Recorder.prototype.stop = function () {
    if (this.state !== "inactive") {
        this.state = "inactive";
        this.monitorNode.disconnect();
        this.scriptProcessorNode.disconnect();

        // MOD NEW
        this.levelMeterNode.disconnect();

        if (!this.config.leaveStreamOpen) {
            this.clearStream();
        }

        this.encoder.postMessage({command: "done"});
    }
};

Recorder.prototype.storePage = function (page) {
    this.recordedPages.push(page);
    this.totalLength += page.length;

    // Stream is finished
    if (page[5] & 4) {
        var outputData = new Uint8Array(this.totalLength);
        var outputIndex = 0;

        for (var i = 0; i < this.recordedPages.length; i++) {
            outputData.set(this.recordedPages[i], outputIndex);
            outputIndex += this.recordedPages[i].length;
        }

        this.eventTarget.dispatchEvent(new CustomEvent('dataAvailable', {
            detail: outputData
        }));

        this.recordedPages = [];
        this.eventTarget.dispatchEvent(new Event('stop'));
    }
};

Recorder.prototype.streamPage = function (page) {
    this.eventTarget.dispatchEvent(new CustomEvent('dataAvailable', {
        detail: page
    }));

    // Stream is finished
    if (page[5] & 4) {
        this.eventTarget.dispatchEvent(new Event('stop'));
    }
};
