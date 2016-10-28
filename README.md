# Fork of Recorderjs

This is a fork of Chris Rudmin's version of Recorderjs. The project's primarily focus is to add additional features to the library which make it more flexible in specific scenarios (see below).
For the original documentation just have a look on https://github.com/chris-rudmin/Recorderjs .

Basically there are two additional parameters for the Recorder constructor:

```js
var recorder = new Recorder(config, existingStream, levelMeterCallback)
```

### Passing an existing stream

The first one takes an existing input stream (from a microphone) so the recorder uses this one instead of creating its own.
This is useful when you do something like an audio setup once before using Recorderjs. Because for each new stream instance that is using a system's microphone the user gets a dialog box asking if he wants to allow that access. Having this box multiple times is very annyoing. Except the user chooses to always allow access to the microphone.

### Passing a level meter callback

This callback function is called several times a second to deliver the current audio level from the input stream. This is useful for some visual feedback to the user while recording so your application feels more responsive.

### TODO: Reduce streaming latency & increase efficiency

When used as a streaming client the current implementation of the recorder delivers one Ogg page in a specific frequency that is based on the buffer configuration. Depending on your protocol stack (websockets, http POSTs etc.) you can deliver those chunks of compressed audio data to a server. This approach has two caveats: 

1. The first two pages consist only of the Ogg stream header and the Opus header with no audio data at all. This introduces an additional delay to your streaming application depending on your page delivery frequency. 

2. There is some overhead for each audio data chunk because of all the additional meta data of an Ogg page. This ratio of audio data vs Ogg overhead gets worse if you stream smaller chunks more frequently.
