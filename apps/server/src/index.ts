import { RookServer } from './ws/wsServer.ts';

const port = Number(process.env.PORT || 3001);
const server = new RookServer();

server.start(port).then(actualPort => {
  console.log(`Let Him Rook WebSocket server running on port ${actualPort}`);
});
