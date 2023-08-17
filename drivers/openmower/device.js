'use strict';

const { Device } = require('homey');
const mqtt = require('mqtt');
const { Point, Polygon } = require('@flatten-js/core');

class OpenmowerDevice extends Device {

    async onInit() {
        this.log(`Init device ${this.getName()}`);
        this.updated = false;
        this.client = null;
    
        this.ready().then( () => {
            this.homey.setTimeout(() => {
                this.checkCapabilities().then( () => {this.updateMower()});
                this.setNetworkEvents();  
            }, 30 * 1000);

            this.mqttConnect();                  
        });

        this.registerCapabilityListener("onoff", async (value, opts) => {
            if (Object.keys(opts).length === 0) {
                // MANUAL IN THE APP
                const commands = this.mowerActions.filter(action => (action.enabled === 1));
                if (value) {
                    for (const command of commands) {
                        if (command.action_id === 'mower_logic:idle/start_mowing') this.processCommand({ id: 'START', name: 'Start/Pause from OnOff' });
                    }
                } else {
                    for (const command of commands) {
                        if (command.action_id === 'mower_logic:mowing/abort_mowing') this.processCommand({ id: 'STOP', name: 'Home from OnOff'});
                    } 
                }
            }
        });
     
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log(changedKeys, oldSettings, newSettings);
    }

    onAdded() {
        this.log(`New device added: ${this.getName()}`);
        this.setAvailable();
    }

    onDeleted() {
        this.log(`Device deleted: ${this.getName()}`);
    }

    async checkCapabilities() {
        for (const capability of Object.keys(this.homey.app.manifest.capabilities)) {
            if (this.hasCapability(capability) === false && capability.startsWith('openmower') === true) {
                this.addCapability(capability)
                this.log('checkCapabilities() added', capability);
            };
        };

        this.setCapabilityValue('mowerModel', 'OpenMower').catch(error => {this.error(this.getName(), 'mowerModel', error)}); // HOME
        if (!this.hasCapability('mowerBatteryVoltage')) this.homey.setTimeout(() => { this.addCapability('mowerBatteryVoltage'); }, 2000);        
    };

    async updateJob() {

    }

    async updateMower() {
        if (this.updated) return;
        this.updated = true;

        this.log('updateMower()');
    };

    async mqttConnect() {
        this.connectError = false;
        if (this.reconn) this.homey.clearTimeout(this.reconn);

        const id = this.getData().id;
        
        let ip;
        ip = '192.168.107.88';
        const mqttPort = 1883;

        this.driver.foundDevices.forEach(device => {
            if (device.data.id === id) {
                ip = device.settings.host;
            }
        });

        let host = `mqtt://${ip}:${mqttPort}`;

        this.log('mqttConnect() Openmower connect attempt', this.getName(), 'on', host);

        this.client = mqtt.connect(host);

        this.client.on('connect', (ackCon) => {
            this.setAvailable();
            this.log('mqttConnect() Openmower connected to', this.getName(), 'on', host);
            this.client.subscribe(['sensors/+/data', 'robot_state/json', 'actions/json', 'map/json', '/action',  '/xbot_driver_gps/xb_pos/json'], (err, granted) => {
                if (err) this.error('Openmower subscribe', err);
                this.log('Openmower subscribe', granted);
            });
        });

        this.client.on('message', (topic, message, packet) => {
            const nu = new Date();
            const seconds = nu.getSeconds();

            if (topic.startsWith('actions/json')) this.processActions(topic, JSON.parse(message));
            else if (topic.startsWith('map/json')) { 
                this.lawnsize = this.processMap(topic, JSON.parse(message));
                if (!this.hasCapability('mowerLawnsize')) {
                    this.addCapability('mowerLawnsize').then(() => this.setCapabilityValue('mowerLawnsize', this.lawnsize)).catch(error => this.error(error));
                } else this.setCapabilityValue('mowerLawnsize', this.lawnsize);
            }
            else if (topic.startsWith('/action')) this.processAction(topic, message.toString());

            // EVERY 5 SECONDS
            if (seconds % 5 === 0) {
                if (topic.startsWith('sensors')) this.processSensors(topic, message);
                else if (topic.startsWith('robot_state')) this.processState(topic, JSON.parse(message));
                else if (topic.startsWith('/xbot')) this.log('xbot GPS', topic, message);                
            }
        });

        this.client.on('error', (error) => {
            this.error('Openmower', error);
            this.client.end();
            this.connectError = true;
            this.setUnavailable('Connection unavailable ' + error.code).catch(error => {this.error(this.getName(), 'error setUnavailable Mower', error)});
            this.reConnect();
        });

    }

    async reConnect() {
        this.reconn = this.homey.setTimeout(() => {
            this.log('reConnect() retry mqtt connection');
            this.mqttConnect();
        }, 5 * 60 * 1000);
    }

    async processSensors(topic, message) {
        if (topic === 'sensors/om_v_battery/data') {
            const voltage = Math.round(message * 100) / 100;
            if (this.hasCapability('mowerBatteryVoltage')) {
                const mowerBatteryVoltage = this.getCapabilityValue('mowerBatteryVoltage');
                this.setCapabilityValue('mowerBatteryVoltage', voltage); // battery voltage
    
                if (mowerBatteryVoltage !== voltage) {
                    this.homey.app.trgMower_battery_voltage_changed.trigger(this, { mowerBatteryVoltage: voltage}, { mowerBatteryVoltage: voltage }).catch(error => {this.error(this.getName(), 'error trigger battery voltage', error)});
                    this.triggerOrNot('mower_battery_voltage_gt', 'mowerBatteryVoltage', voltage);
                    this.triggerOrNot('mower_battery_voltage_lt', 'mowerBatteryVoltage', voltage);
                }
            }
        }
        if (topic === 'sensors/om_charge_current/data') {
            const current = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerChargeCurrent')) {
                const openmowerChargeCurrent = this.getCapabilityValue('openmowerChargeCurrent');
                this.setCapabilityValue('openmowerChargeCurrent', current);
                if (openmowerChargeCurrent !== current) {
                    this.triggerOrNot('mower_chargeCurrent_gt', 'openmowerChargeCurrent', current);
                    this.triggerOrNot('mower_chargeCurrent_lt', 'openmowerChargeCurrent', current);
                }
            }
        }
        if (topic === 'sensors/om_v_charge/data') {
            const chargeVoltage = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerChargeVolt')) {
                const openmowerChargeVolt = this.getCapabilityValue('openmowerChargeVolt');
                this.setCapabilityValue('openmowerChargeVolt', chargeVoltage);
                if (openmowerChargeVolt !== chargeVoltage) {
                    this.triggerOrNot('mower_chargeVolt_gt', 'openmowerChargeVolt', chargeVoltage);
                    this.triggerOrNot('mower_chargeVolt_lt', 'openmowerChargeVolt', chargeVoltage);
                }
            }
        }
        if (topic === 'sensors/om_mow_esc_temp/data') {
            const tempEsc = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerTempEsc')) {
                const openmowerTempEsc = this.getCapabilityValue('openmowerTempEsc');
                this.setCapabilityValue('openmowerTempEsc', tempEsc);
                if (openmowerTempEsc !== tempEsc) {
                    this.triggerOrNot('mower_temp_esc_gt', 'openmowerTempESC', tempEsc);
                    this.triggerOrNot('mower_temp_esc_lt', 'openmowerTempESC', tempEsc);
                }
            }
        }
        if (topic === 'sensors/om_left_esc_temp/data') {
            const tempEsc = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerTempEscLeft')) {
                const openmowerTempEsc = this.getCapabilityValue('openmowerTempEscLeft');
                this.setCapabilityValue('openmowerTempEscLeft', tempEsc);
                if (openmowerTempEsc !== tempEsc) {
                    this.triggerOrNot('mower_temp_escLeft_gt', 'openmowerTempESCLeft', tempEsc);
                    this.triggerOrNot('mower_temp_escLeft_lt', 'openmowerTempESCLeft', tempEsc);
                }
            }
        }
        if (topic === 'sensors/om_right_esc_temp/data') {
            const tempEsc = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerTempEscRight')) {
                const openmowerTempEsc = this.getCapabilityValue('openmowerTempEscRight');
                this.setCapabilityValue('openmowerTempEscRight', tempEsc);
                if (openmowerTempEsc !== tempEsc) {
                    this.triggerOrNot('mower_temp_escRight_gt', 'openmowerTempESCRight', tempEsc);
                    this.triggerOrNot('mower_temp_escRight_lt', 'openmowerTempESCRight', tempEsc);
                }
            }
        }
        if (topic === 'sensors/om_mow_motor_temp/data') {
            const tempEsc = Math.round(message * 100) / 100;
            if (this.hasCapability('openmowerTempMotor')) {
                const openmowerTempEsc = this.getCapabilityValue('openmowerTempMotor');
                this.setCapabilityValue('openmowerTempMotor', tempEsc);
                if (openmowerTempEsc !== tempEsc) {
                    this.triggerOrNot('mower_temp_escMotor_gt', 'openmowerTempESCMotor', tempEsc);
                    this.triggerOrNot('mower_temp_escMotor_lt', 'openmowerTempESCMotor', tempEsc);
                }
            }
        }
    }

    async processState(topic, message) {

        // STATUS
        const statusCode = message.current_state;
        if (statusCode in this.homey.app.OMSTATUSCODES) {
            const statusMsg = this.homey.__(`OMSTATUSCODES.${statusCode}`);
            const prevStatus = this.getCapabilityValue('mowerState');
            const statusToken = {statusCode, statusMsg, serial: this.getData().id};

            if (prevStatus != statusMsg) {
                this.log(this.getName(), 'set status and trigger', statusToken);
                this.setCapabilityValue('mowerState', statusMsg).catch(error => {this.error(this.getName(), 'Mower state', error)});
                this.homey.app.trgMower_status.trigger(statusToken, statusToken).catch(error => {this.error(this.getName(), 'error trigger Status Mower', error)});
                this.homey.app.trgMower_status_device.trigger(this, statusToken , statusToken).catch(error => {this.error(this.getName(), 'error trigger Status Mower', error)});
            }
        }
        // ERROR
        const errorCode = this.checkForStateError(message);
        if (errorCode in this.homey.app.OMERRORCODES) {
            const errorMsg =  this.homey.__(`OMERRORCODES.${errorCode}`);
            const prevError = this.getCapabilityValue('mowerError');
            const errorToken = {errorCode, errorMsg, serial: this.getData().id};

            if (prevError != errorMsg) {
                this.log(this.getName(), 'set error and trigger', errorToken);
                this.setCapabilityValue('mowerError', errorMsg).catch(error => {this.error(this.getName(), 'Mower error', error)});
                this.homey.app.trgMower_error.trigger(errorToken, errorToken).catch(error => {this.error(this.getName(), 'error trigger Error Mower', error)}); 
                this.homey.app.trgMower_error_device.trigger(this, errorToken, errorToken).catch(error => {this.error(this.getName(), 'error trigger Error Mower', error)});           
            }
        }
        // ALARM
        if (errorCode !== '0') {
            this.setCapabilityValue('alarm_Mower', true).catch(error => {this.error(this.getName(), 'alarm Mower', error)});
        }   else {
            this.setCapabilityValue('alarm_Mower', false).catch(error => {this.error(this.getName(), 'alarm Mower', error)});
        }

        // ACTION STATE
        //if (statusCode === 'IDLE') {
            // this.setCapabilityValue('onoff', false).catch(error => {this.error(this.getName(), 'onoff Mower', error)});  // PAUSE
            // this.triggerCapabilityListener("onoff", false, {auto: true}).catch(error => {this.error(this.getName(), 'error triggerCapabilityListener onoff', error)});
        //}

        this.setCapabilityValue('measure_battery', Number(message.battery_percentage * 100)).catch(error => {this.error(this.getName(), 'Battery error', error)});

        if (this.hasCapability('openmowerGPSResolution')) {
            if (message.pose.pos_accuracy !== 999) {
                this.setCapabilityValue('openmowerGPSResolution', Math.round(message.pose.pos_accuracy * 1000) / 10)
                .then(() => {
                    if (message.pose.pos_accuracy !== 999) {
                        this.triggerOrNot('mower_gps_accuracy_gt', 'openmowerGPSAccuracy', Math.round(message.pose.pos_accuracy * 1000) / 10);
                        this.triggerOrNot('mower_gps_accuracy_lt', 'openmowerGPSAccuracy', Math.round(message.pose.pos_accuracy * 1000) / 10);
                    }
                })
                .catch(error => {this.error(this.getName(), 'GPSResolution error', error)});
                if (this.hasCapability('openmowerGPSSignal')) {
                    this.setCapabilityValue('openmowerGPSSignal', Math.round(message.gps_percentage * 100))
                        .then(() => {
                            if (message.pose.pos_accuracy !== 999) {
                                this.triggerOrNot('mower_gps_signal_gt', 'openmowerGPSSignal', Math.round(message.gps_percentage * 100));
                                this.triggerOrNot('mower_gps_signal_lt', 'openmowerGPSSignal', Math.round(message.gps_percentage * 100));
                            }
                        })
                        .catch(error => {this.error(this.getName(), 'mowerGPSSignal error', error)});
                }
            }

            if (message.pose.pos_accuracy === 999) {
                this.setCapabilityValue('openmowerGPSResolution', 0);
                this.setCapabilityValue('openmowerGPSSignal', 0);
            }
        }

    }

    checkForStateError(message) {
        /*
        'EMERGENCY'   :  'Emergency',   
        'GPS'         :  'GPS Inaccurate',   // When not IDLE!
        'BATTERY_LOW' :  'Battery low',
        'CHARGE_ERROR':  'Charge error',
        */
        if (message.emergency) return 'EMERGENCY';

        if (message.battery_percentage < 0.05) return 'BATTERY_LOW';

        if (message.current_state === 'IDLE' && !message.is_charging) return 'CHARGE_ERROR';

        const gpsLimit = this.getSetting('positionAccuracy') / 100;
        if (message.current_state === 'MOWING' && gpsLimit < message.pose.pos_accuracy) return 'GPS';

        if (message.pose.pos_accuracy !== 999 && this.area.isValid()) {
            const p = new Point( message.pose.x, message.pose.y );
            // this.log('Robot inside Area', this.area.contains(p));
            if (!this.area.contains(p)) return 'OUTSIDE_MAP';
        }

        return String(0);
    }

    async processActions(topic, message) {
        // this.log('processActions', topic, message);
        this.mowerActions = message;
    }

    async processAction(topic, message) {
        this.log('processAction', topic, message);

        let statusCode = '';
        switch (message) {
            case 'mower_logic:mowing/pause':
                this.setCapabilityValue('onoff', false).catch(error => {this.error(this.getName(), 'onoff Mower', error)});  // PAUSE
                statusCode = 'PAUSE';
                break;
            case 'mower_logic:mowing/abort_mowing':
                this.setCapabilityValue('onoff', false).catch(error => {this.error(this.getName(), 'onoff Mower', error)});  // PAUSE
                break;
            case 'mower_logic:mowing/skip_area':
                statusCode = 'SKIP';
                break;
            case 'mower_logic:idle/start_area_recording':
                statusCode = 'RECORDING';
                break;
            case 'mower_logic:idle/start_mowing':
                this.setCapabilityValue('onoff', true).catch(error => {this.error(this.getName(), 'onoff Mower', error)});
                break;
            case 'mower_logic:mowing/continue':
                this.setCapabilityValue('onoff', true).catch(error => {this.error(this.getName(), 'onoff Mower', error)});
                break;
            default:
                break;
        }
       
        // STATUS
        if (statusCode !== '' && statusCode in this.homey.app.OMSTATUSCODES) {
            const statusMsg = this.homey.__(`OMSTATUSCODES.${statusCode}`);
            const prevStatus = this.getCapabilityValue('mowerState');
            const statusToken = {statusCode, statusMsg, serial: this.getData().id};

            if (prevStatus != statusMsg) {
                this.log(this.getName(), 'set status and trigger', statusToken);
                this.setCapabilityValue('mowerState', statusMsg).catch(error => {this.error(this.getName(), 'Mower state', error)});
                this.homey.app.trgMower_status.trigger(statusToken, statusToken).catch(error => {this.error(this.getName(), 'error trigger Status Mower', error)});
                this.homey.app.trgMower_status_device.trigger(this, statusToken , statusToken).catch(error => {this.error(this.getName(), 'error trigger Status Mower', error)});
            }
        }
    }

    processCommand(commandCode) {
        /*
            const OMCOMMANDCODES = {
                'START'     :  'Start or Continue',
                'STOP'      :  'Abort or Pause',
                'RECORDING' :  'Start Area Recording',
                'SKIP'      :  'Skip Area'
            };
        */
        let command;
        if (commandCode.id === 'START') {
            command = this.mowerActions.filter(action => (action.enabled === 1 && (action.action_id === 'mower_logic:idle/start_mowing' || action.action_id === 'mower_logic:mowing/continue')));
        } else if (commandCode.id === 'STOP') {
            command = this.mowerActions.filter(action => (action.enabled === 1 && action.action_id === 'mower_logic:mowing/abort_mowing'));
        } else if (commandCode.id === 'PAUSE') {
            command = this.mowerActions.filter(action => (action.enabled === 1 && action.action_id === 'mower_logic:mowing/pause'));
        } else if (commandCode.id === 'RECORDING') {
            command = this.mowerActions.filter(action => (action.enabled === 1 && action.action_id === 'mower_logic:idle/start_area_recording'));
        } else if (commandCode.id === 'SKIP') {
            command = this.mowerActions.filter(action => (action.enabled === 1 && action.action_id === 'mower_logic:mowing/skip_area'));
        }

        if (command.length === 1) {
            this.log('processCommand() Publish to MQTT: action', command[0].action_id, 'name', command[0].action_name);
            this.client.publish('/action', command[0].action_id, { qos: 0, retain: false }, (error) => {
                if (error) {
                  this.error(error)
                }
            });
            return true
        }

        this.log('processCommand() command not enabled', commandCode);
        return false;
    }
    

    triggerOrNot(trigger, field, value) {
        let triggerResult = false;
        if (this.triggers && this.triggers.hasOwnProperty(trigger)) {
            this.triggers[trigger].forEach((argTrig) => {
                if (trigger.includes('_lt')) {
                    if (Number(value) < Number(argTrig[field])) {
                        if (argTrig.trigger) {
                            triggerResult = true;
                            this.log('Trigger', trigger, field, value, argTrig[field], argTrig.trigger);
                            let token = {};
                            let state = {};
                            token[field] = value;
                            state[field] = Number(argTrig[field]);
                            this.homey.flow.getDeviceTriggerCard(trigger).trigger(this, token, state).then(() => {argTrig.trigger = false;}).catch(error => {this.error(this.getName(), trigger, error)});
                        }
                    } else {
                        if (!argTrig.trigger) {
                            triggerResult = false;
                            argTrig.trigger = true;
                        }
                    }
                }
                if (trigger.includes('_gt')) {
                    if (Number(value) > Number(argTrig[field])) {
                        if (argTrig.trigger) {
                            triggerResult = true;
                            this.log('Trigger', trigger, field, value, argTrig[field], argTrig.trigger);
                            let token = {};
                            let state = {};
                            token[field] = value;
                            state[field] = Number(argTrig[field]);
                            this.homey.flow.getDeviceTriggerCard(trigger).trigger(this, token, state).then(() => {argTrig.trigger = false;}).catch(error => {this.error(this.getName(), trigger, error)});
                        }
                    } else {
                        if (!argTrig.trigger) {
                            triggerResult = false;
                            argTrig.trigger = true;
                        }
                    }                   
                }
            });
        }
    }

    async setNetworkEvents() {
        this.log('setNetworkEvents()');
        if (this.driver.foundDevices.length === 0) {
            this.log('setNetworkEvents() no discovery result');
            return;
        }

        let initialResultsOpenmower;
        let device;

        this.driver.foundDevices.forEach(dev =>{
            if (dev.data.id === this.getData().id) {
                initialResultsOpenmower = dev.discoveryResult;
                this.log(initialResultsOpenmower);
                device = dev;
            }
        });

        // CHANGE OF IP
		initialResultsOpenmower.on('addressChanged', discoveryResult => {
            this.log('discoveryDevices() change IP from', device.settings.host, 'to', discoveryResult.address);
            device.settings.host = discoveryResult.address;
            this.setSettings({host: discoveryResult.address})
            .then(() => {
                this.client.end();
                this.mqttConnect();
            });
		});

		// CHANGE OF LASTSEEN AND CONNECTION ERROR EXISTS
		initialResultsOpenmower.on('lastSeenChanged', discoveryResult => {
            if (this.connectError) {
                this.log('discoveryDevices() lastSeenChanged, error in connection restart MQTT', this.getName());
                this.mqttConnect();
            }
		});
    }

    processMap(topic, map) {
        this.log('processMap');
        let polygonArray = [];
        map.working_areas.forEach( area => {
            area.outline.push({ x: area.outline[0].x, y: area.outline[0].y })
            for(let i = 0; i < area.outline.length - 3 ; i++) {
                polygonArray.push([area.outline[i].x, area.outline[i].y]);
            }            
        });

        this.area = new Polygon(polygonArray);
        const size = Number(this.area.area().toFixed(2));
        return size; 
    }

}

module.exports = OpenmowerDevice;
