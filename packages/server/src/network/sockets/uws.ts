import WebSocket from '../websocket';
import Connection from '../connection';

import log from '@kaetram/common/util/log';
import config from '@kaetram/common/config';
import Utils from '@kaetram/common/util/utils';
import { Modules } from '@kaetram/common/network';
import { App, DISABLED } from 'uws';

import type SocketHandler from '../sockethandler';
import type { HeaderWebSocket } from '../connection';
import type { WebSocket as WS, HttpRequest, HttpResponse, us_socket_context_t, us_listen_socket } from 'uws';
import type { ConnectionInfo } from '@kaetram/common/types/network';

export default class UWS extends WebSocket {
    public constructor(socketHandler: SocketHandler) {
        super(config.host, config.port, socketHandler);

        (App({}) as any)
            .get('/*', this.httpResponse.bind(this))
            .ws('/*', {
                compression: DISABLED,
                idleTimeout: 15,
                maxPayloadLength: 32 * 1024 * 1024,

                upgrade: this.handleUpgrade.bind(this),
                open: this.handleConnection.bind(this),
                message: this.handleMessage.bind(this),
                close: this.handleClose.bind(this)
            })
            .listen(config.host, Number(config.port), (token: us_listen_socket) => {
                if (!token) throw new Error(`Failed to listen on port ${config.port}`);

                this.initializedCallback?.();
            });
    }

    private handleUpgrade(
        response: HttpResponse,
        request: HttpRequest,
        context: us_socket_context_t
    ): void {
        response.upgrade(
            {
                url: request.getUrl(),
                remoteAddress: request.getHeader('cf-connecting-ip')
            },
            request.getHeader('sec-websocket-key'),
            request.getHeader('sec-websocket-protocol'),
            request.getHeader('sec-websocket-extensions'),
            context
        );
    }

    private handleConnection(socket: WS<ConnectionInfo>): void {
        let instance = Utils.createInstance(Modules.EntityType.Player),
            connection = new Connection(instance, socket as HeaderWebSocket);

        socket.getUserData().instance = instance;

        this.addCallback?.(connection);
    }

    private handleMessage(socket: WS<ConnectionInfo>, data: ArrayBuffer): void {
        let connection = this.socketHandler.get(socket.getUserData().instance);

        if (!connection)
            return log.error(`No connection found for ${socket.getUserData().instance}`);

        connection.messageRate++;

        if (connection.messageRate > config.messageLimit) return connection.reject('ratelimit');

        try {
            let message = new TextDecoder().decode(data);

            if (connection.isDuplicate(message)) return;

            connection.messageCallback?.(JSON.parse(message));
        } catch (error) {
            log.error(`Message could not be parsed: ${new TextDecoder().decode(data)}.`);
            log.error(error);
        }
    }

    private handleClose(socket: WS<ConnectionInfo>): void {
        let connection = this.socketHandler.get(socket.getUserData().instance);

        if (!connection)
            return log.error(`No connection found closing ${socket.getUserData().instance}`);

        connection.closed = true;

        this.socketHandler.remove(connection.instance);

        connection.handleClose();
    }
}