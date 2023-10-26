/* eslint-disable no-undef */
/* eslint-disable no-console */

const EventEmitter = require('events');
const axios = require('axios').default;

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const requestClient = axios.create();

API_BASE_URI = "https://api-de.devicewise.com/api";
API_APP_TOKEN = "DJMYYngGNEit40vA";

class ZCS extends EventEmitter {
    constructor(appId, homey) {

        super();
        this.homey = homey;
        this.debug = false;
        this.appId = appId;
        this.thingKey = '';
        this.username = 'martinverbeek1958@gmail.com';
        this.password = '3526@Zcs';
        this.deviceArray = [];
        this.laststatus = {};
        this.lasterror = {};
        this.refreshTokenTimeout = null;
        this.clouds = {
            zcs: {
                url: 'api-de.devicewise.com/api',
                clientToken: 'DJMYYngGNEit40vA',
            },
        };
    }

    async login() {
        this.homey.log('Login to ZCS');
        await this.appAuth();
        /*
        if (this.session && this.session.access_token) {
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
        */
    }

    async appAuth() {
        const data =  {
            auth : {
                command: 'api.authenticate',
                params: {
                    username: this.username,
                    password: this.password,
                }
            }
        }
        // const response = await this.apiRequest('post', data);
        const response = await axios.post('https://api.devicewise.com/rest/auth', new URLSearchParams({
            username: 'martinverbeek1958@gmail.com',
            password: '3526@Zcs',
          }))
        this.homey.log(response);
    }

    async userAuth() {
        const data =  {
            "auth" : {
                "command" : "api.authenticate",
                "params" : {
                    "appId": this.appId,
                    "appToken": API_APP_TOKEN,
                    "thingKey": this.thingKey,
                }
            }
        }
        const response = await this.apiRequest('post', data);
        this.homey.log(response);
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

    async resetBlade(device) {
        // EXEC
    }


    async onOffline() {
        this.homey.log('ZCS device offline');
        this.emit('offline');      
    }

    async onEnd() {  
        this.homey.log('ZCS device end');
        this.emit('end');     
    }

    async onClose() {
        this.homey.log('ZCS device closed');
        this.emit('close');      
    }

    async onError(error) {
        this.homey.error('ZCS device ERROR: ' + error);
        this.emit('error', error);     
    }

    async apiRequest(method, data) {
        const headers = {
            accept: 'application/json',
            'content-type': 'application/json',
        };
        return await requestClient({
            method: method || 'get',
            url: `https://${this.clouds['zcs'].url}`,
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
            // TODO
        } else {
            this.homey.error('Try to send a message but could not find the mower');
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
        })
        .catch((error) => {
            this.homey.error(error);
            error.response && this.homey.error(JSON.stringify(error.response.data, ' ', 4));
        });
    }
}

module.exports = ZCS;