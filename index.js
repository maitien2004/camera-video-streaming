const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { spawn } = require('child_process');
const express = require('express');
const cors = require('cors');
const STREAM_MAGIC_BYTES = "jsmp";

dotenv.config();

var STREAM_SECRET = process.env.SECRET_KEY,
  STREAM_PORT = process.env.STREAM_PORT,
  WEBSOCKET_PORT = process.env.WEBSOCKET_PORT,
  RECORD_STREAM = process.env.RECORD_STREAM === 'true' ? true : false,
  IP_ADDRESS = process.env.IP_ADDRESS,
  CAMERA_VIDEO_STREAM_URL = process.env.CAMERA_VIDEO_STREAM_URL,
  CAMERA_FPS = parseInt(process.env.CAMERA_FPS),
  CAMERA_VIDEO_WIDTH = parseInt(process.env.CAMERA_VIDEO_WIDTH),
  CAMERA_VIDEO_HEIGHT = parseInt(process.env.CAMERA_VIDEO_HEIGHT),
  WEBSERVER_PORT = parseInt(process.env.WEBSERVER_PORT);

// Websocket Server
var socketServer = new WebSocket.Server({ port: WEBSOCKET_PORT, perMessageDeflate: false });
socketServer.connectionCount = 0;
socketServer.on('connection', function (socket, upgradeReq) {
  socketServer.connectionCount++;
  console.log(
    'New WebSocket Connection: ',
    (upgradeReq || socket.upgradeReq).socket.remoteAddress,
    (upgradeReq || socket.upgradeReq).headers['user-agent'],
    '(' + socketServer.connectionCount + ' total)'
  );
  var streamHeader = new Buffer(8);
  streamHeader.write(STREAM_MAGIC_BYTES);
  streamHeader.writeUInt16BE(CAMERA_VIDEO_WIDTH, 4);
  streamHeader.writeUInt16BE(CAMERA_VIDEO_HEIGHT, 6);
  socket.send(streamHeader, {
    binary: true
  });

  socket.on('close', function (code, message) {
    socketServer.connectionCount--;
    console.log(
      'Disconnected WebSocket (' + socketServer.connectionCount + ' total)'
    );
  });
});
socketServer.broadcast = function (data) {
  socketServer.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
var streamServer = http.createServer(function (request, response) {
  var params = request.url.substr(1).split('/');

  if (params[0] !== STREAM_SECRET) {
    console.log(
      'Failed Stream Connection: ' + request.socket.remoteAddress + ':' +
      request.socket.remotePort + ' - wrong secret.'
    );
    response.end();
  }

  response.connection.setTimeout(0);
  console.log(
    'Stream Connected: ' +
    request.socket.remoteAddress + ':' +
    request.socket.remotePort
  );
  request.on('data', function (data) {
    socketServer.broadcast(data);
    if (request.socket.recording) {
      request.socket.recording.write(data);
    }
  });
  request.on('end', function () {
    console.log('close');
    if (request.socket.recording) {
      request.socket.recording.close();
    }
  });

  // Record the stream to a local file?
  if (RECORD_STREAM) {
    var path = 'recordings/' + Date.now() + '.ts';
    request.socket.recording = fs.createWriteStream(path);
  }
});
streamServer.listen(STREAM_PORT);

//Camera Stream
const ffmpegOptions = [
  '-rtsp_transport',
  'tcp',
  '-i',
  CAMERA_VIDEO_STREAM_URL,
  '-f',
  'mpegts',
  '-s',
  CAMERA_VIDEO_WIDTH + 'x' + CAMERA_VIDEO_HEIGHT,
  '-codec:v',
  'mpeg1video',
  '-b:a',
  '800k',
  '-stats',
  '-r',
  CAMERA_FPS,
  'http://' + IP_ADDRESS + ':' + STREAM_PORT + '/' + STREAM_SECRET + '/'
];

const ffmpeg = spawn('ffmpeg', ffmpegOptions, { detached: false });
ffmpeg.stdout.on('data', (data) => {
  console.log(`stdout: ${data}`);
});

ffmpeg.stderr.on('data', (data) => {
  console.log(`stderr: ${data}`);
});
ffmpeg.on('close', (code) => {
  console.log(`ffmpeg process exited with code ${code}`);
});


var app = express();
app.use(cors());
app.use('/', express.static(__dirname + '/public'));
app.listen(WEBSERVER_PORT, () => {
  console.log(`Webserver listening on http:/${IP_ADDRESS}`);
});

console.log(`Listening for incomming MPEG-TS Stream on http:/${IP_ADDRESS}:${STREAM_PORT}/${STREAM_SECRET}`);
console.log(`Awaiting WebSocket connections on ws://${IP_ADDRESS}:${WEBSOCKET_PORT}/`);
