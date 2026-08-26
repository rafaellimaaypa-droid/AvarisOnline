const WebSocket = require('../websocket').default;
const Connection = require('../connection').default;

const log = require('@kaetram/common/util/log').default;
const config = require('@kaetram/common/config').default;
const Utils = require('@kaetram/common/util/utils').default;
const { Modules } = require('@kaetram/common/network');
const { App, DISABLED } = require('uws');

module.exports = class UWS extends WebSocket {
    constructor(socketHandler) {
        super(config.host, config.port, socketHandler);

        const app = App();

        app.get('/*', this.httpResponse.bind(this));
        app.ws('/*', {
            compression: DISABLED,
            idleTimeout: 15,
            maxPayloadLength: 32 * 1024 * 1024,
            upgrade: this.handleUpgrade.bind(this),
            open: this.handleConnection.bind(this),
            message: this.handleMessage.bind(this),
            close: this.handleClose.bind(this)
        });
        app.listen(config.host, Number(config.port), (token) => {
            if (!token) throw new Error(`Failed to listen on port ${config.port}`);

            if (this.initializedCallback) this.initializedCallback();
        });
    }

    handleUpgrade(response, request, context) {
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

    handleConnection(socket) {
        let instance = Utils.createInstance(Modules.EntityType.Player),
            connection = new Connection(instance, socket);

        socket.getUserData().instance = instance;

        if (this.addCallback) this.addCallback(connection);
    }

    handleMessage(socket, data) {
        let connection = this.socketHandler.get(socket.getUserData().instance);

        if (!connection)
            return log.error(`No connection found for ${socket.getUserData().instance}`);

        connection.messageRate++;

        if (connection.messageRate > config.messageLimit) return connection.reject('ratelimit');

        try {
            let message = new TextDecoder().decode(data);

            if (connection.isDuplicate(message)) return;

            if (connection.messageCallback) connection.messageCallback(JSON.parse(message));
        } catch (error) {
            log.error(`Message could not be parsed: ${new TextDecoder().decode(data)}.`);
            log.error(error);
        }
    }

    handleClose(socket) {
        let connection = this.socketHandler.get(socket.getUserData().instance);

        if (!connection)
            return log.error(`No connection found closing ${socket.getUserData().instance}`);

        connection.closed = true;

        this.socketHandler.remove(connection.instance);

        connection.handleClose();
    }
};