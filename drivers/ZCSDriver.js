'use strict';

const Homey = require('homey');
const ZCS = require('./ZCS');

class ZCSDriver extends Homey.Driver {

    async onInit() { 
        this.log('Init driver ZCS');

        this.settings = this.homey.settings.get('ZCS');
        if (!this.settings) {
            this.settings = {
                "debug": false,
                "username" : "",
                "password" : ""
            };
            this.homey.settings.set('ZCS', this.settings);
        }
        
        if (!this.settings.debug) this.settings.debug = false;

        this.devices = [];
        this.lastData = [];

        this.homey.settings.on('set', async (key) => {  
            this.log('onInit() Update Settings:');    

            this.oldSettings = this.settings;
            this.settings = this.homey.settings.get('ZCS')
            this.log('onInit() New settings:', 'ZCS')
            this.log('onInit()', this.settings)

            if (this.ZCS) {
                this.ZCS.debug = this.settings.debug;
            }
        });

        this.ZCS = new ZCS('xx', this.homey);
        this.ZCS.login();
        // this.doTheWorx();
    }

    async onUninit() {
        if (this.ZCS) {
            this.log('onUnload() for', 'ZCS');
            this.ZCS.onUnload()
        }
    }

    async doTheWorx() {
        if (this.settings.username === '' || this.settings.password === '') return;

        this.ZCS = new ZCS(this.settings.username, this.settings.password, this.homey, 'ZCS');
        this.ZCS.debug = this.settings.debug;
        await this.ZCS.login();
        if (!this.ZCS.session || this.ZCS.session === undefined) {
            this.error('DoTheWorx no session');
            this.homey.api.realtime('Invalid', 'Invalid credentials');
            return;
        } else this.homey.api.realtime('Invalid', 'Logged on successfully');

		this.ZCS
			.on('foundDevice', async (mower) => {
                try {
                    if (this.ZCS.debug) this.log('foundDevice', mower);
                    const dev = this.getDevice({serial: mower.serial_number, product_id: mower.product_id});
                    dev.updateMower(mower.serial_number);
                }   
                catch (error) {
                    // NOOP
                }              
			})

            // TRIGGER STATUS AND ERROR INFO, OR SAVE DATA WHEN MOWER IS NOT FOUND IN HOMEY
            .on('mqttMessage', async (mower, data, topic) => {
                if (this.ZCS.debug) this.log('mqttMessage', JSON.stringify(data, ' ', 4));
                this.updateStatus(mower, data);
                for (const m of this.ZCS.deviceArray) {
                    if (m.serial_number == mower.serial) {
                        m.messageData = data;    // save last status data
                    }
                };
			})

            .on('updateDevice', async (mower, data) => {
                this.updateDeviceStatus(mower, data);
                for (const m of this.ZCS.deviceArray) {
                    if (m.serial_number == mower.serial_number) {
                        m.statusData = data;    // save last status data
                    }
                };
			})

            .on('mowerOnline', async (mower, status) => {
                this.setAvailability(mower)
			})

            .on('mowerOffline', async (mower, status) => {
                this.setAvailability(mower)
			})

            .on('connect', async (data) => {
				this.log('connected to', 'ZCS', 'cloud');
                this.setDevicesOnline();
			})
            
            .on('end', async () => {
				this.log('Cloud connection', 'ZCS', 'ended, devices going offline');
                this.setDevicesOffline('Worx Cloud Connectoin Ended');
			})

            .on('error', async (error) => {
                this.homey.api.realtime('error', 'Failed, invalid credentials?');
			})
    }

    async setDevicesOffline(message) {
        this.getDevices().forEach((mower) => {
            for (const m of this.ZCS.deviceArray) {
                if (m.serial_number == mower.getData().serial) mower.setUnavailable(message);
            };
        });
    }

    async setDevicesOnline() {
        this.getDevices().forEach((mower) => {
            for (const m of this.ZCS.deviceArray) {
                if (m.serial_number == mower.getData().serial) mower.setAvailable();
            };          
        });
    }

    async updateDeviceStatus(mower, data) {
        if (!this.ZCS) {
            this.log('Worx not initialised returning');
            return;
        };
        let bwt;
        if ('blade_work_time' in mower) bwt = Math.round(mower.blade_work_time/60);
        if ('blade_work_time_reset' in mower && 'blade_work_time_reset' !== null) bwt = Math.round((mower.blade_work_time - mower.blade_work_time_reset)/60);
        
        if ('online' in mower) this.setAvailability(mower);
    }

    async updateStatus(mower, data) {

        if (!this.ZCS) {
            this.log('Worx not initialised returning');
            return;
        };

        this.log('updateStatus with MQTT message for', mower.serial_number, mower.name);
        // this.log(JSON.stringify(data, ' ', 4));

        var dev;

        try {
            dev = this.getDevice({serial: mower.serial_number, product_id: mower.product_id});
        } catch (error) {
            this.error('updateStatus() Device not found in Homey', mower.name, mower.serial_number);
            return;
        }

        const devName = dev.getName();

        // MOWER DATA.cfg FIELDS (configuration fields)
        if (data.cfg) {
            if (data.cfg.sc && 'p' in data.cfg.sc) {
                if (!dev.hasCapability('mowerTimeExtend')) await dev.addCapability('mowerTimeExtend');
                dev.setCapabilityValue('mowerTimeExtend', data.cfg.sc.p); // mover time extend
            }
            if (!dev.vision && data.cfg.sc && 'm' in data.cfg.sc) {
                if (!dev.hasCapability('commandPartyMode')) await dev.addCapability('commandPartyMode');
                let partyMode = false;
                if (data.cfg.sc.m === 2) partyMode = true;
                const currentPartyMode = dev.getCapabilityValue('commandPartyMode');
                if (partyMode !== currentPartyMode) {
                    if (partyMode === true) this.homey.app.trgMower_partyMode_on.trigger(dev).catch(error => {this.error(devName, 'error trigger Party mode on', error)});
                    else this.homey.app.trgMower_partyMode_off.trigger(dev).catch(error => {this.error(devName, 'error trigger Party mode off', error)});
                }
                dev.setCapabilityValue('commandPartyMode', partyMode); // mover Partymode
            }
            //VISION
            if (dev.vision && data.cfg.sc && 'enabled' in data.cfg.sc) {
                if (!dev.hasCapability('commandPartyMode')) await dev.addCapability('commandPartyMode');
                let partyMode = false;
                if (data.cfg.sc.enabled === 0) partyMode = true;
                const currentPartyMode = dev.getCapabilityValue('commandPartyMode');
                if (partyMode !== currentPartyMode) {
                    if (partyMode === true) this.homey.app.trgMower_partyMode_on.trigger(dev).catch(error => {this.error(devName, 'error trigger Party mode on', error)});
                    else this.homey.app.trgMower_partyMode_off.trigger(dev).catch(error => {this.error(devName, 'error trigger Party mode off', error)});
                }
                dev.setCapabilityValue('commandPartyMode', partyMode); // mover Partymode
            }
            if (data.cfg.mz && !('p' in data.cfg.mz)) {
                let numberZones = 0;
                let percentageZones = [0];
                data.cfg.mz.forEach(zone => {
                    if (zone !== 0) {
                        numberZones++;
                    }
                });
                dev.numberZones = numberZones;
                if (numberZones > 0) {
                    if (!dev.hasCapability('mowerZones')) await dev.addCapability('mowerZones');
                    data.cfg.mzv.forEach(zoneNumber => {
                        !percentageZones[zoneNumber] ? percentageZones[zoneNumber] = 10 : percentageZones[zoneNumber] += 10;
                    });
                    dev.setCapabilityValue('mowerZones', JSON.stringify(percentageZones));
                }
            }

        }

        // MOWER DATA.dat FIELDS (status information)
        if (data.dat) {
            
            if ('ls' in data.dat && 'le' in data.dat) {
                const statusCode = String(data.dat.ls);
                const errorCode = String(data.dat.le);
                const statusMsg = this.homey.__(`STATUSCODES.${statusCode}`);
                const prevStatus = dev.getCapabilityValue('mowerState');
                const errorMsg =  this.homey.__(`ERRORCODES.${errorCode}`);
                const prevError = dev.getCapabilityValue('mowerError');
                const statusToken = {statusCode, statusMsg, serial: dev.getData().serial};
                const errorToken = {errorCode, errorMsg, serial: dev.getData().serial};

                if (prevStatus != statusMsg) {
                    this.log(devName, 'set status and trigger', statusToken);
                    dev.setCapabilityValue('mowerState', statusMsg).catch(error => {this.error(devName, 'Mower state', error)});
                    this.homey.app.trgMower_status.trigger(statusToken, statusToken).catch(error => {this.error(devName, 'error trigger Status Mower', error)});
                    this.homey.app.trgMower_status_device.trigger(dev, statusToken , statusToken).catch(error => {this.error(devName, 'error trigger Status Mower', error)});
                }
                if (prevError != errorMsg) {
                    this.log(devName, 'set error and trigger', errorToken);
                    dev.setCapabilityValue('mowerError', errorMsg).catch(error => {this.error(devName, 'Mower error', error)});
                    this.homey.app.trgMower_error.trigger(errorToken, errorToken).catch(error => {this.error(devName, 'error trigger Error Mower', error)}); 
                    this.homey.app.trgMower_error_device.trigger(dev, errorToken, errorToken).catch(error => {this.error(devName, 'error trigger Error Mower', error)});           
                }
                
                if (errorCode !== '0') {
                    dev.setCapabilityValue('alarm_Mower', true).catch(error => {this.error(devName, 'alarm Mower', error)});
                }   else {
                    dev.setCapabilityValue('alarm_Mower', false).catch(error => {this.error(devName, 'alarm Mower', error)});
                }
                
                if (statusCode === '1') {
                    dev.mowerAtHome = true;
                    dev.setCapabilityValue('onoff', false).catch(error => {this.error(devName, 'onoff Mower', error)}); // HOME
                    dev.triggerCapabilityListener("onoff", false, {auto: true}).catch(error => {this.error(devName, 'error triggerCapabilityListener onoff', error)});
                    dev.updateJob('init', '1')
                }   else dev.updateJob('update', statusCode)

                if (statusCode == '2' || statusCode == '3'  || statusCode == '7') {
                    dev.mowerAtHome = false;
                    dev.setCapabilityValue('onoff', true).catch(error => {this.error(devName, 'onoff Mower', error)});  // START SEQUENCE/LEAVING HOME or MOWING
                    dev.triggerCapabilityListener("onoff", true, {auto: true}).catch(error => {this.error(devName, 'error triggerCapabilityListener onoff', error)});
                }
            }

            if ('st' in data.dat) {
                
                if ('b' in data.dat.st) {
                    // BWT (BWT RESET!!!)
                    let bwt = data.dat.st.b; 
                    if ('blade_work_time_reset' in mower && 'blade_work_time_reset' !== null) bwt = bwt - mower.blade_work_time_reset;
                    if (!dev.hasCapability('mowerBladetime')) await dev.addCapability('mowerBladetime');
                    const mowerBT = Math.round(bwt / 60);     // mower bladetime
                    dev.setCapabilityValue('mowerBladetime', mowerBT).catch(error => {this.error(devName, 'mowerBladetime Mower', error)});
                    this.triggerOrNot(dev, 'mower_bwt_gt', 'mowerBladeHours', bwt);
                }
                if ('wt' in data.dat.st) {
                    const mowerWT = Math.round(data.dat.st.wt / 60);    // mower worktime
                }
                if ('d' in data.dat.st) {
                    const mowerD = Math.round(data.dat.st.d / 1000);    // mower distance
                    if (!dev.hasCapability('mowerDistance')) await dev.addCapability('mowerDistance');
                    dev.setCapabilityValue('mowerDistance', mowerD).catch(error => {this.error(devName, 'mowerDistance Mower', error)});
                }
            }

            if ('bt' in data.dat) {
                if ('t' in data.dat.bt && dev.hasCapability('mowerBatteryTemperature')) {
                    const mowerBatteryTemperature = dev.getCapabilityValue('mowerBatteryTemperature');
                    dev.setCapabilityValue('mowerBatteryTemperature', data.dat.bt.t ); // battery temp
                    if (mowerBatteryTemperature !== data.dat.bt.t) {
                        this.homey.app.trgMower_battery_temperature_changed.trigger(dev, { mowerBatteryTemperature: data.dat.bt.t }, { mowerBatteryTemperature: data.dat.bt.t }).catch(error => {this.error(devName, 'error trigger battery temperature', error)});
                        this.triggerOrNot(dev, 'mower_battery_temperature_gt', 'mowerBatteryTemperature', data.dat.bt.t);
                        this.triggerOrNot(dev, 'mower_battery_temperature_lt', 'mowerBatteryTemperature', data.dat.bt.t);
                    }
                }
                if ('v' in data.dat.bt && dev.hasCapability('mowerBatteryVoltage')) {
                    const mowerBatteryVoltage = dev.getCapabilityValue('mowerBatteryVoltage');
                    dev.setCapabilityValue('mowerBatteryVoltage', data.dat.bt.v); // battery voltage

                    if (mowerBatteryVoltage !== data.dat.bt.v) {
                        this.homey.app.trgMower_battery_voltage_changed.trigger(dev, { mowerBatteryVoltage: data.dat.bt.v }, { mowerBatteryVoltage: data.dat.bt.v }).catch(error => {this.error(devName, 'error trigger battery voltage', error)});
                        this.triggerOrNot(dev, 'mower_battery_voltage_gt', 'mowerBatteryVoltage', data.dat.bt.v);
                        this.triggerOrNot(dev, 'mower_battery_voltage_lt', 'mowerBatteryVoltage', data.dat.bt.v);
                    }
                }
                if ('p' in data.dat.bt) {
                    dev.setCapabilityValue('measure_battery', data.dat.bt.p);
                }

            }

            if ('dmp' in data.dat) {
                if (data.dat.dmp[0] && dev.hasCapability('mowerGradient')) {
                    const mowerGradient = dev.getCapabilityValue('mowerGradient');
                    dev.setCapabilityValue('mowerGradient', data.dat.dmp[0]); // Gradient
                    if (mowerGradient !== data.dat.dmp[0]) {
                        this.homey.app.trgMower_gradient_changed.trigger(dev, { mowerGradient: data.dat.dmp[0] }, { mowerGradient: data.dat.dmp[0] }).catch(error => {this.error(devName, 'error trigger Gradient', error)});
                        this.triggerOrNot(dev, 'mower_gradient_gt', 'mowerGradient', data.dat.dmp[0] );
                        this.triggerOrNot(dev, 'mower_gradient_lt', 'mowerGradient', data.dat.dmp[0] );
                    }
                }
                if (data.dat.dmp[1] && dev.hasCapability('mowerInclination')) {
                    const mowerInclination = dev.getCapabilityValue('mowerInclination');
                    dev.setCapabilityValue('mowerInclination', data.dat.dmp[1]); // Inclination
                    if (mowerInclination !== data.dat.dmp[1]) {
                        this.homey.app.trgMower_inclination_changed.trigger(dev, { mowerInclination: data.dat.dmp[1] }, { mowerInclination: data.dat.dmp[1] }).catch(error => {this.error(devName, 'error trigger Inclination', error)});
                        this.triggerOrNot(dev, 'mower_inclination_gt', 'mowerInclination', data.dat.dmp[1] );
                        this.triggerOrNot(dev, 'mower_inclination_lt', 'mowerInclination', data.dat.dmp[1] );
                    }
                }
            }

            if ('rain' in data.dat && 'cnt' in data.dat.rain) {                
                dev.setCapabilityValue('mowerRaindelay', data.dat.rain.cnt);  // raindelay left in minutes
            }
            
            if ('lk' in data.dat && dev.hasCapability('commandLock')) {
                let mowerLock = false                                     // mower lock
                if (data.dat.lk == 1) mowerLock = true;
                dev.setCapabilityValue('commandLock', mowerLock);
            }
            if ('rsi' in data.dat) {
                dev.setCapabilityValue('wifiState', `rsi: ${data.dat.rsi}`); // wifi
            }
            if ('fw' in data.dat) {
                dev.setCapabilityValue('mowerFirmware', data.dat.fw.toString()); 
            }
        }

        // MOWER RAW FIELDS (mower cloud information fields)
        if (mower && mower.lawn_size) {
            dev.setCapabilityValue('mowerLawnsize', mower.lawn_size); // m2 lawn
        }
    }

    triggerOrNot(dev, trigger, field, value) {
        let triggerResult = false;
        if (dev.triggers && dev.triggers.hasOwnProperty(trigger)) {
            dev.triggers[trigger].forEach((argTrig) => {
                if (trigger.includes('_lt')) {
                    if (Number(value) < Number(argTrig[field])) {
                        if (argTrig.trigger) {
                            triggerResult = true;
                            this.log('Trigger', trigger, field, value, argTrig[field], argTrig.trigger);
                            let token = {};
                            let state = {};
                            token[field] = value;
                            state[field] = Number(argTrig[field]);
                            this.homey.flow.getDeviceTriggerCard(trigger).trigger(dev, token, state).then(() => {argTrig.trigger = false;}).catch(error => {this.error(dev.getName(), trigger, error)});
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
                            this.homey.flow.getDeviceTriggerCard(trigger).trigger(dev, token, state).then(() => {argTrig.trigger = false;}).catch(error => {this.error(dev.getName(), trigger, error)});
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

    async setAvailability(mower) {
        if (!this.ZCS) return;
        try {
            //
        } catch (error) {
            this.log('setAvailability', mower.serial_number, error);
            // NOOP, get around to it next time, device might not be in Homey just yet
        }
    }

    async onPairListDevices() {
        let devices = [];
        let product_code;
        if (this.ZCS && this.ZCS.session !== undefined) {
            for (const mower of this.ZCS.deviceArray) {
                for (const product of this.ZCS.products) {
                    if (product.id === mower.product_id) {
                        product_code = product.code;
                    }
                }
                this.homey.log(`Pairlist ${product_code} ${mower.name} with serialnumber ${mower.serial_number}`);
                let dev = { name: mower.name, data: { serial: mower.serial_number, product_id: mower.product_id }};
                devices = devices.concat(dev); 
            }
        } else throw new Error('Please supply correct user credentials in app setup');

        return devices;
    }

}

module.exports = ZCSDriver;