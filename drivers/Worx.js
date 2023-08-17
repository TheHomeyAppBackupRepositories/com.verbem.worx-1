/* eslint-disable no-undef */
/* eslint-disable no-console */

const EventEmitter = require('events');
const axios = require('axios').default;
const awsIot = require('aws-iot-device-sdk');
const { v4: uuidv4 } = require('uuid');
const tough = require('tough-cookie');
const crypto = require('crypto');
const { HttpsCookieAgent } = require('http-cookie-agent/http');

const not_allowed = 60000 * 10;
const mqtt_poll_max = 60000;
const poll_check = 1000; //1 sec.
const ping_interval = 1000 * 60 * 10; //5 Minutes
const pingMqtt = false;
const max_request = 20;
const cookieJar = new tough.CookieJar();
const requestClient = axios.create({
    withCredentials: true,
    httpsAgent: new HttpsCookieAgent({
        cookies: {
            jar: cookieJar,
        },
    }),
});

class Worx extends EventEmitter {
    constructor(username, password, homey, server) {

        super();
        this.homey = homey;
        this.debug = false;
        this.config = {};
        this.config.mail = username;
        this.config.password = password;
        this.config.server = server;
        this.deviceArray = [];
        // this.productArray = [];
        this.fw_available = {};
        this.laststatus = {};
        this.lasterror = {};
        this.userAgent = 'homeyWorx ';
        this.reLoginTimeout = null;
        this.loadActivity = {};
        this.refreshTokenTimeout = null;
        this.pingInterval = {};
        this.requestCounter = 0;
        this.requestCounterStart = Date.now();
        this.mqtt_blocking = 0;
        this.mqtt_restart = null;
        this.reconnectCounter = 0;
        this.poll_check_time = 0;
        // this.session = {};
        this.mqttC = {};
        this.mqtt_response_check = {};
        this.clouds = {
            worx: {
                url: 'api.worxlandroid.com',
                loginUrl: 'https://id.eu.worx.com/',
                clientId: '150da4d2-bb44-433b-9429-3773adc70a2a',
                redirectUri: 'com.worxlandroid.landroid://oauth-callback/',
                mqttPrefix: 'WX',
            },
            kress: {
                url: 'api.kress-robotik.com',
                loginUrl: 'https://id.eu.kress.com/',
                clientId: '931d4bc4-3192-405a-be78-98e43486dc59',
                redirectUri: 'com.kress-robotik.mission://oauth-callback/',
                mqttPrefix: 'KR',
            },
            landxcape: {
                url: 'api.landxcape-services.com',
                loginUrl: 'https://id.landxcape-services.com/',
                clientId: 'dec998a9-066f-433b-987a-f5fc54d3af7c',
                redirectUri: 'com.landxcape-robotics.landxcape://oauth-callback/',
                mqttPrefix: 'LX',
            },
            ferrex: {
                url: 'api.watermelon.smartmower.cloud',
                loginUrl: 'https://id.watermelon.smartmower.cloud/',
                clientId: '10078D10-3840-474A-848A-5EED949AB0FC',
                redirectUri: 'cloud.smartmower.watermelon://oauth-callback/',
                mqttPrefix: 'FE',
            },
        };
    }

    async login() {
        // Reset the connection indicator during startup
        this.userAgent += this.version;

        if (!this.config.mail || !this.config.password) {
            this.homey.error('Please set username and password in the instance settings');
            return;
        }
        // eslint-disable-next-line no-control-regex
        if (/[\x00-\x08\x0E-\x1F\x80-\xFF]/.test(this.config.password)) {
            this.homey.error('Password is now encrypted: Please re-enter the password in the instance settings');
            return;
        }

        this.homey.log('Login to ' + this.config.server);
        await this.simpleLogin();
        if (this.session.access_token) {
            await this.getDeviceList();
            this.getProductList();
            await this.updateDevices();
            this.homey.log('Start MQTT connection');
            await this.start_mqtt();
            this.updateInterval = this.homey.setInterval(async () => {
                await this.updateDevices();
            }, 10 * 60 * 1000); // 10 minutes

            this.refreshTokenInterval = this.homey.setInterval(() => {
                this.refreshToken();
            }, (this.session.expires_in - 200) * 1000);
        }
    }

    async simpleLogin() {
        const data = await requestClient({
            url: this.clouds[this.config.server].loginUrl + 'oauth/token',
            method: 'post',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': this.userAgent,
                'accept-language': 'de-de',
            },
            data: JSON.stringify({
                client_id: this.clouds[this.config.server].clientId,
                username: this.config.mail,
                password: this.config.password,
                scope: '*',
                grant_type: 'password',
            }),
        })
        .then((response) => {
            this.session = response.data;
            if (this.debug) this.homey.log(JSON.stringify(this.session, ' ', 4));
            this.homey.log(`Connected to ${this.config.server} server`);
        })
        .catch((error) => {
            this.homey.error(error);
            error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
        });
        return data;
    }

    async getDeviceList() {
        await requestClient({
            method: 'get',
            url: `https://${this.clouds[this.config.server].url}/api/v2/product-items?status=1&gps_status=1`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': this.userAgent,
                authorization: 'Bearer ' + this.session.access_token,
                'accept-language': 'de-de',
            },
        })
        .then(async (res) => {
            this.homey.log(`Found ${res.data.length} devices`);

                this.homey.log(JSON.stringify(res.data, ' ', 4));
                this.homey.log(`https://${this.clouds[this.config.server].url}/api/v2/product-items?status=1&gps_status=1`);
                this.homey.log('Bearer ' + this.session.access_token);
                this.homey.log(this.userAgent);
                

            for (const device of res.data) {
                // this.homey.log(device);
                const id = device.serial_number;
                const name = device.name;
                this.fw_available[device.serial_number] = false;
                this.deviceArray.push(device);
                this.homey.setTimeout(() => {
                    this.emit('foundDevice', device);
                }, 10000);
            }
            this.userDevices = res.data;
        })
        .catch((error) => {
            this.homey.error(error);
            error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
        });
    }

    async getProductList() {
        await requestClient({
            method: 'get',
            url: `https://${this.clouds[this.config.server].url}/api/v2/products`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': this.userAgent,
                authorization: 'Bearer ' + this.session.access_token,
                'accept-language': 'de-de',
            },
        })
        .then(async (res) => {
            this.homey.log(`Found ${res.data.length} products`);
            
            if (this.debug) this.homey.log(JSON.stringify(res.data, ' ', 4));

            // for (const product of res.data) {
            //    this.productArray.push(product);
            // }
            this.products = res.data; 
        })
        .catch((error) => {
            this.homey.error(error);
            error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
        });
    }

    async updateDevices() {
        const statusArray = [
            {
                path: 'rawMqtt',
                url: `https://${this.clouds[this.config.server].url}/api/v2/product-items/$id/?status=1&gps_status=1`,
                desc: 'All raw data of the mower',
            },
        ];
        let count_array = 0;
        for (const device of this.deviceArray) {
            for (const element of statusArray) {
                const url = element.url.replace('$id', device.serial_number);
                requestClient({
                    method: 'get',
                    url: url,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'user-agent': this.userAgent,
                        authorization: 'Bearer ' + this.session.access_token,
                        'accept-language': 'de-de',
                    },
                })
                .then(async (res) => {
                    if (!res.data) {
                        return;
                    }
                    if (element.path === 'rawMqtt') {
                        this.deviceArray[count_array] = res.data;
                        ++count_array;
                    }
                    this.emit('updateDevice', device, res.data);
                })
                .catch((error) => {
                    if (error.response) {
                        if (error.response.status === 401) {
                            this.homey.log(JSON.stringify(error.response.data, ' ', 4));
                            this.homey.log(element.path + ' receive 401 error. Refresh Token in 60 seconds');
                            this.refreshTokenTimeout && this.homey.clearTimeout(this.refreshTokenTimeout);
                            this.refreshTokenTimeout = this.homey.setTimeout(() => {
                                this.refreshToken();
                            }, 1000 * 60);
                            return;
                        }
                    }
                    this.homey.error(element.url);
                    this.homey.error(error);
                    error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
                });
            }
        }
    }

    async start_mqtt() {
        if (this.deviceArray.length === 0) {
            this.homey.log('No mower found to start mqtt');
            return;
        }

        this.userData = await this.apiRequest('users/me', false);
        if (this.debug) this.homey.log(JSON.stringify(this.userData, ' ', 4));
        this.connectMqtt();
    }

    connectMqtt() {
        try {
            this.initConnection = true;
            const uuid = this.deviceArray[0].uuid || uuidv4();
            const mqttEndpoint = this.deviceArray[0].mqtt_endpoint || 'iot.eu-west-1.worxlandroid.com';
            if (this.deviceArray[0].mqtt_endpoint == null) {
                this.homey.log(`Cannot read mqtt_endpoint use default`);
            }
            const headers = this.createWebsocketHeader();
            const split_mqtt = mqttEndpoint.split('.');
            const region = split_mqtt.length === 3 ? split_mqtt[2] : 'eu-west-1';

            this.userData['mqtt_endpoint'] = mqttEndpoint;
            this.mqttC = awsIot.device({
                clientId: `${this.clouds[this.config.server].mqttPrefix}/USER/${this.userData.id}/homey/${uuid}`,
                username: 'homey',
                protocol: 'wss-custom-auth',
                host: mqttEndpoint,
                region: region,
                customAuthHeaders: headers,
                baseReconnectTimeMs: 8000,
                // keepalive: 750,
                debug: !!this.debug,
            });

            this.mqttC.on('offline', async () => {
                this.onOffline();
            });

            this.mqttC.on('end', async () => {
                this.onEnd();
            });

            this.mqttC.on('close', async () => {
                this.onClose();
            });

            this.mqttC.on('disconnect', async (packet) => {
                this.onDisconnect(packet);
            });

            this.mqttC.on('connect', async () => {
                this.onConnect();
            });

            this.mqttC.on('reconnect', async () => {
                this.onReconnect();
            });

            this.mqttC.on('packetreceive', async (packet) => {
                if ('cmd' in packet && packet.cmd !== 'publish' && this.debug) this.homey.log('MQTT packet', JSON.stringify(packet, ' ', 4));
                if ('cmd' in packet && packet.cmd === 'pingresp' && this.deviceArray.length > 0) {
                    this.homey.log('packetreceive Initiated Pings');
                    this.deviceArray.forEach(mower => {
                        this.sendPing(mower);
                    });
                }
            });

            this.mqttC.on('message', async (topic, message) => {
                let data;
                try {
                    data = JSON.parse(message);
                } catch (error) {
                    this.homey.log('message is not JSON', message);
                    return;
                }

                this.homey.log(JSON.stringify(data, ' ', 4));
                this.mqtt_blocking = 0;
                const mower = this.deviceArray.find((mower) => mower.mqtt_topics.command_out === topic);
                const merge = this.deviceArray.findIndex((merge) => merge.mqtt_topics.command_out === topic);

                if (mower) {
                    this.homey.log(
                        'Worxcloud MQTT get Message for mower ' + mower.name + ' (' + mower.serial_number + ')',
                    );
                    this.onMessage(mower, topic, data);
                } else {
                    this.homey.log('Worxcloud MQTT could not find mower topic in mowers');
                }

                if (pingMqtt) this.pingToMqtt(mower);
            });

            this.mqttC.on('error', async (error) => {
                this.onError(error);
            });

        } catch (error) {
            this.homey.error('Worx MQTT ERROR: ' + error);
            this.mqttC = undefined;
            this.onError();
        }
    }

    async onOffline() {
        this.homey.log('Worxcloud MQTT offline');
        this.emit('offline');      
    }

    async onEnd() {  
        this.homey.log('MQTT end');
        this.emit('end');     
    }

    async onClose() {
        this.homey.log('MQTT closed');
        this.emit('close');      
    }

    async onError(error) {
        this.homey.error('MQTT ERROR: ' + error);
        if (`${error}`.includes('ECONNRESET')) {
            this.homey.log('onError() Worx Reset MQTT Blocking for ECONNRESET');
            this.mqtt_blocking = 0;
        }
        this.emit('error', error);     
    }

    async onMessage(mower, topic, message) {
        this.mqtt_blocking = 0;     // sucessful event, reset blocking counter
        this.emit('mqttMessage', mower, message, topic);     
    }

    async onConnect() {
        this.homey.log('MQTT connected to: ' + this.userData.mqtt_endpoint);
        this.mqtt_blocking = 0;
        this.mqtt_restart && this.homey.clearTimeout(this.mqtt_restart);
        for (const mower of this.deviceArray) {
            if (this.debug) this.homey.log('onConnect() Worxcloud MQTT subscribe to ' + mower.mqtt_topics.command_out);
            this.mqttC.subscribe(mower.mqtt_topics.command_out, { qos: 1 });
            if (this.initConnection) {
                this.requestCounter++;
                this.mqttC.publish(mower.mqtt_topics.command_in, '{}', { qos: 1 });
            }
            if (pingMqtt) this.pingToMqtt(mower);
        }
        this.initConnection = false;
        this.emit('connect');
    }

    async onDisconnect(packet) {
        if (this.debug) this.homey.log('onDisconnect()' + packet); else this.homey.log('MQTT disconnect');
        this.emit('disconnect');
    }

    async onReconnect() {
        this.homey.log(`onReconnect() since App start: ${this.reconnectCounter}, blocking counter ${this.mqtt_blocking}`);
        ++this.mqtt_blocking;
        ++this.reconnectCounter;
        if (this.mqtt_blocking > 15) {
            this.homey.log(
                'onReconnect() No Connection to Worx for 1 minute. Please check your internet connection or in your App if Worx blocked you for 24h. Mqtt connection will restart automatic in 1h',
            );
            this.homey.log(`onReconnect() Request counter since App start: ${this.requestCounter}`);
            this.homey.log(`onReconnect() Reconnects since App start: ${this.reconnectCounter}`);
            this.homey.log(`onReconnect() Adapter start date: ${new Date(this.requestCounterStart).toLocaleString()}`);
            if (this.deviceArray.length > 1) {
                this.homey.log(`onReconnect() More than one mower found.`);
                for (const mower of this.deviceArray) {
                    this.homey.log(
                        `onReconnect() Mower Endpoint : ${mower.mqtt_endpoint}  mqtt registered ${mower.mqtt_registered} iot_registered ${mower.iot_registered} online ${mower.online} `,
                    );
                }
            }

            this.mqttC.end();
            this.mqtt_restart && this.homey.clearTimeout(this.mqtt_restart);
            this.mqtt_restart = this.homey.setTimeout(async () => {
                this.homey.log('onReconnect() Restart Mqtt after 1h');
                this.start_mqtt();
            }, 1 * 60 * 1000 * 60); // 1 hour
        } else this.emit('reconnect');
    }

    /**
     * @param {object} actual mower
     */
    pingToMqtt(mower) {
        const mowerSN = mower.serial_number ? mower.serial_number : '';
        this.pingInterval[mowerSN] && this.homey.clearTimeout(this.pingInterval[mowerSN]);
        this.homey.log('Reset ping');
        this.pingInterval[mowerSN] = this.homey.setInterval(() => {
            this.sendPing(mower);
        }, ping_interval);
    }

    async sendPing(mower, no_send, merge_message, command) {
        const language =
            mower.last_status &&
            mower.last_status.payload &&
            mower.last_status.payload.cfg &&
            mower.last_status.payload.cfg.lg
                ? mower.last_status.payload.cfg.lg
                : 'de';
        const mowerSN = mower.serial_number;
        const tzNow = new Date().toLocaleString(undefined, { timeZone: this.homey.clock.getTimezone() });
        const now = new Date(tzNow);
        const message = {
            id: 1024 + Math.floor(Math.random() * (65535 - 1025)),
            cmd: 0,
            lg: language,
            sn: mowerSN,
            // Important: Send the time in your local timezone, otherwise mowers clock will be wrong.
            tm: `${('0' + now.getHours()).slice(-2)}:${('0' + now.getMinutes()).slice(-2)}:${(
                '0' + now.getSeconds()
            ).slice(-2)}`,
            dt: `${('0' + now.getDate()).slice(-2)}/${('0' + (now.getMonth() + 1)).slice(-2)}/${now.getFullYear()}`,
            ...merge_message,
        };
        if (this.debug) this.homey.log('Start MQTT ping: ' + JSON.stringify(message));
        if (no_send) {
            return message;
        } else {
            this.sendMessage(JSON.stringify(message), mowerSN, command);
        }
    }

    createWebsocketHeader() {
        const accessTokenParts = this.session.access_token.replace(/_/g, '/').replace(/-/g, '+').split('.');
        const headers = {
            'x-amz-customauthorizer-name': 'com-worxlandroid-customer',
            'x-amz-customauthorizer-signature': accessTokenParts[2],
            jwt: `${accessTokenParts[0]}.${accessTokenParts[1]}`,
        };
        return headers;
    }

    disconnect() {
        this.mqttC.end();
        this.homey.clearInterval(this.interval);
    }

    async apiRequest(path, withoutToken, method, data) {
        const headers = {
            accept: 'application/json',
            'content-type': 'application/json',
            'user-agent': this.userAgent,
            'accept-language': 'de-de',
        };
        if (!withoutToken) {
            headers['authorization'] = 'Bearer ' + this.session.access_token;
        }
        return await requestClient({
            method: method || 'get',
            url: `https://${this.clouds[this.config.server].url}/api/v2/${path}`,
            headers: headers,
            data: data || null,
        })
        .then(async (res) => {
            if (this.debug) this.homey.log(JSON.stringify(res.data, ' ', 4));
            return res.data;
        })
        .catch((error) => {
            this.homey.error(error);
            if (error.response) {
                if (error.response.status === 401) {
                    this.homey.log(JSON.stringify(error.response.data, ' ', 4));
                    this.homey.log(path + ' receive 401 error. Refresh Token in 30 seconds');
                    this.refreshTokenTimeout && this.homey.clearTimeout(this.refreshTokenTimeout);
                    this.refreshTokenTimeout = this.homey.setTimeout(() => {
                        this.refreshToken();
                    }, 1000 * 30);
                    return;
                }
                this.homey.error(JSON.stringify(error.response.data, ' ', 4));
            }
        });
    }

    extractHidden(body) {
        const returnObject = {};
        if (body) {
            const matches = body.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g);
            for (const match of matches) {
                returnObject[match[1]] = match[2];
            }
        }
        return returnObject;
    }
    
    getCodeChallenge() {
        let hash = '';
        let result = '';
        const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        result = '';
        for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
        result = Buffer.from(result).toString('base64');
        result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        hash = crypto.createHash('sha256').update(result).digest('base64');
        hash = hash.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        return [result, hash];
    }

    async onUnload() {
        this.homey.log('onUnload', this.server);
        try {
            this.mqttC.end();
            this.refreshTokenTimeout && this.homey.clearTimeout(this.refreshTokenTimeout);
            this.updateInterval && this.homey.clearInterval(this.updateInterval);
            this.mqtt_restart && this.homey.clearTimeout(this.mqtt_restart);
            this.sleepTimer && this.homey.clearTimeout(this.sleepTimer);
            for (const mower of this.deviceArray) {
                this.pingInterval[mower.serial_number] && this.homey.clearTimeout(this.pingInterval[mower.serial_number]);
            }
            this.refreshTokenInterval && this.homey.clearInterval(this.refreshTokenInterval);

        } catch (e) {
            this.homey.error('onUnload()', e)
        }
    }

    /**
     * @param {string} message JSON stringify example : '{'cmd':3}'
     */
    async sendMessage(message, serial, command) {
        this.homey.log('Worxcloud MQTT sendMessage to ' + serial + ' Message: ' + message);

        if (serial == null) {
            this.homey.error('please give a serial number!');
        }

        const mower = this.deviceArray.find((mower) => mower.serial_number === serial);

        if (mower) {
            if (this.mqttC) {
                this.requestCounter++;
                if (this.debug) this.homey.log(`Request Counter: ${this.requestCounter}`);
                try {
                    if (this.debug) this.homey.log(`length:  ${Object.keys(this.mqtt_response_check).length}`);
                    if (Object.keys(this.mqtt_response_check).length > 50) {
                        this.cleanup_json();
                    }
                    const data = await this.sendPing(mower, true, JSON.parse(message));
                    this.mqtt_response_check[data.id] = data;
                    await this.lastCommand(this.mqtt_response_check, 'request', data.id, command);
                    if (this.debug) this.homey.log(`this.mqtt_response_check:  ${JSON.stringify(this.mqtt_response_check)}`);
                    this.mqttC.publish(mower.mqtt_topics.command_in, JSON.stringify(data), { qos: 1 });
                } catch (error) {
                    this.homey.log(`sendMessage normal:  ${error}`);
                    this.mqttC.publish(mower.mqtt_topics.command_in, message, { qos: 1 });
                }
            }
        } else {
            this.homey.error('Try to send a message but could not find the mower');
        }
    }

    async lastCommand(data, sent, dataid, command) {
        try {
            const data_json = data;
            const ids = dataid;
            const send = sent;
            const sn = data_json[ids]['sn'];
            if (this.debug) this.homey.log(`lastCommand_start:  ${JSON.stringify(data)}`);
            // const lastcommand = await this.getStateAsync(`${sn}.mower.last_command`);
            // const new_merge = lastcommand.val ? JSON.parse(lastcommand.val) : [];
            const new_merge = [];
            if (send === 'other') {
                data_json[ids]['request'] = 0;
                data_json[ids]['response'] = Date.now();
                data_json[ids]['action'] = 'APP';
                data_json[ids]['user'] = 'APP';
                new_merge.push(data_json[ids]);
            } else if (send === 'request') {
                data_json[ids][send] = Date.now();
                data_json[ids]['response'] = 0;
                data_json[ids]['action'] = command;
                data_json[ids]['user'] = 'homey';
                new_merge.push(data_json[ids]);
            } else {
                const merge = new_merge.findIndex((request) => request.id === ids);
                if (merge && new_merge[merge] && new_merge[merge][send] != null) {
                    new_merge[merge][send] = Date.now();
                } else {
                    this.homey.log(`UNDEFINED:  ${JSON.stringify(data_json)}`);
                    this.homey.log(`UNDEFINED_id:  ${ids}`);
                    this.homey.log(`UNDEFINED_sent:  ${send}`);
                    return;
                }
            }
            if (new_merge.length > max_request) new_merge.shift();
            // await this.setStateAsync(`${sn}.mower.last_command`, JSON.stringify(new_merge), true);
        } catch (e) {
            this.homey.error('lastCommand: ' + e);
        }
    }

    cleanup_json() {
        try {
            const delete_time = Date.now() - 24 * 60 * 1000 * 60;
            Object.keys(this.mqtt_response_check).forEach(async (key) => {
                if (
                    this.mqtt_response_check[key].request &&
                    this.mqtt_response_check[key].request > 0 &&
                    this.mqtt_response_check[key].request < delete_time
                ) {
                    delete this.mqtt_response_check[key];
                } else if (
                    this.mqtt_response_check[key].response &&
                    this.mqtt_response_check[key].response > 0 &&
                    this.mqtt_response_check[key].response < delete_time
                ) {
                    delete this.mqtt_response_check[key];
                }
            });
        } catch (e) {
            //Nothing
        }
    }

    async refreshToken() {
        this.homey.log('Refresh token');
        await requestClient({
            url: this.clouds[this.config.server].loginUrl + 'oauth/token?',
            method: 'post',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'user-agent': this.userAgent,
                'accept-language': 'de-de',
            },
            data: JSON.stringify({
                client_id: this.clouds[this.config.server].clientId,
                scope: 'user:profile mower:firmware mower:view mower:pair user:manage mower:update mower:activity_log user:certificate data:products mower:unpair mower:warranty mobile:notifications mower:lawn',
                refresh_token: this.session.refresh_token,
                grant_type: 'refresh_token',
            }),
        })
        .then((response) => {
            if (this.debug) this.homey.log(JSON.stringify(response.data, ' ', 4));
            this.session = response.data;
            if (this.mqttC) {
                this.mqttC.updateCustomAuthHeaders(this.createWebsocketHeader());
            } else {
                this.homey.log('Cannot update token for MQTT connection. MQTT Offline!');
            }
        })
        .catch((error) => {
            this.homey.error(error);
            error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
        });
    }
}

module.exports = Worx;