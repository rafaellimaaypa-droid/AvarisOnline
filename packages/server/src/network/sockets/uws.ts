// @ts-nocheck
import WebSocket from '../websocket';
import Connection from '../connection';

import log from '@kaetram/common/util/log';
import config from '@kaetram/common/config';
import Utils from '@kaetram/common/util/utils';
import { Modules } from '@kaetram/common/network';
import { WebSocketServer } from 'ws';
import http from 'http';

import type SocketHandler from '../sockethandler';
import type { HeaderWebSocket } from '../connection';

export default class UWS extends WebSocket {
    private wss: WebSocketServer;
    private server: http.Server;

    public constructor(socketHandler: SocketHandler) {
        super(config.host, config.port, socketHandler);

        this.server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('Avaris Server is running\n');
        });

        this.wss = new WebSocketServer({ noServer: true });

        this.server.on('upgrade', (request, socket, head) => {
            this.wss.handleUpgrade(request, socket, head, (ws) => {
                this.wss.emit('connection', ws, request);
            });
        });

        this.wss.on('connection', (socket: any, request: any) => {
            socket.upgradeReq = request;
            this.handleConnection(socket);

            socket.on('message', (data: any) => {
                this.handleMessage(socket, data);
            });

            socket.on('close', () => {
                this.handleClose(socket);
            });
        });

        this.server.listen(Number(config.port), config.host, () => {
            log.info(`Server listening on port ${config.port}`);
            this.initializedCallback?.();
        });
    }

    private handleConnection(socket: any): void {
        let instance = Utils.createInstance(Modules.EntityType.Player),
            connection = new Connection(instance, socket as HeaderWebSocket);

        socket.instance = instance;

        this.addCallback?.(connection);
    }

    private handleMessage(socket: any, data: any): void {
        let connection = this.socketHandler.get(socket.instance);

        if (!connection)
            return log.error(`No connection found for ${socket.instance}`);

        connection.messageRate++;

        if (connection.messageRate > config.messageLimit) return connection.reject('ratelimit');

        try {
            let message = data.toString();

            if (connection.isDuplicate(message)) return;

            connection.messageCallback?.(JSON.parse(message));
        } catch (error) {
            log.error(`Message could not be parsed.`);
            log.error(error);
        }
    }

    private handleClose(socket: any): void {
        let connection = this.socketHandler.get(socket.instance);

        if (!connection)
            return log.error(`No connection found closing ${socket.instance}`);

        connection.closed = true;

        this.socketHandler.remove(connection.instance);

        connection.handleClose();
    }
}
// Forced update at 2026-08-26 02:57:19

// Build fix timestamp: 20260826-030120

// Build fix timestamp: 20260826-085106
