'use strict';

const Homey = require('homey');
const Logger = require('./captureLog.js');
const ERRORCODES = {
    99: 'Any Error',
    0: 'No error',
    1: 'Trapped',
    2: 'Lifted',
    3: 'Wire missing',
    4: 'Outside wire',
    5: 'Raining',
    6: 'Close door to mow',
    7: 'Close door to go home',
    8: 'Blade motor blocked',
    9: 'Wheel motor blocked',
    10: 'Trapped recovery timeout',
    11: 'Upside down',
    12: 'Battery low',
    13: 'Reverse wire',
    14: 'Charge error',
    15: 'Timeout finding home',
    16: 'Mower locked',
    17: 'Battery over temperature',
    18: 'dummy model',
    19: 'Battery trunk open timeout',
    20: 'wire sync',
    21: 'msg num'
};
const STATUSCODES = {
    99: 'Any Status',
    98: 'Offline',
    0: 'IDLE',
    1: 'Home',
    2: 'Start sequence',
    3: 'Leaving home',
    4: 'Follow wire',
    5: 'Searching home',
    6: 'Searching wire',
    7: 'Mowing',
    8: 'Recovering from lifted', //2
    9: 'Recovering from trapped', //1
    10: 'Recovering from blocked blade', //8
    11: 'Debug',
    12: 'Remote control',
    13: 'escape from off limits',
    30: 'Going home',
    31: 'Zone training',
    32: 'Edge Cut',
    33: 'Searching zone',
    34: 'Pause'
};
const COMMANDCODES = {
    0: 'Poll',
    1: 'Start',
    2: 'Stop',
    3: 'Home',
    4: 'Start Zone Taining',
    5: 'Lock',
    6: 'Unlock',
    7: 'Restart Robot',
    8: 'Pause when follow wire',
    9: 'Safe Homing',
    90: 'Edge cut',
    91: 'Enable Party Mode',
    92: 'Disable Party Mode'
};

const OMERRORCODES = {
    "99": 'Any Error',
    "0":  'No error',
    'EMERGENCY'   :  'Emergency',   
    'GPS'         :  'GPS Inaccurate',   // When not IDLE!
    'OUTSIDE_MAP' :  'Outside map area',   // When not IDLE!
    'BATTERY_LOW' :  'Battery low',
    'CHARGE_ERROR':  'Charge error',
    'BATTERY_TEMP':  'Battery temperature'
};
const OMSTATUSCODES = {
    "99"        :  'Any status',
    "98"        :  'Offline',
    'IDLE'      :  'Home',
    'UNDOCKING' :  'Leaving home',
    'MOWING'    :  'Mowing',
    'DOCKING'   :  'Going home',
    'RECORDING' :  'Area recording',
    'PAUSE'     :  'Pause',
    'SKIP'      :  'Skipping area'
};
const OMCOMMANDCODES = {
    'START'     :  'Start or Continue',
    'STOP'      :  'Abort mowing',
    'PAUSE'     :  'Pause mowing',
    'RECORDING' :  'Start area recording',
    'SKIP'      :  'Skip area'
};

class WorxApp extends Homey.App {
	
	onInit() {
		this.logger = new Logger(this.homey, 'log', 400);

		this.log(`Worx ${this.manifest.version} is initialising.`);
        this.OMCOMMANDCODES = OMCOMMANDCODES;
        this.OMERRORCODES = OMERRORCODES;
        this.OMSTATUSCODES = OMSTATUSCODES;

		this.registerFlowCards();
        this.homey.setTimeout(() => {
            this.initMatrix();
        }, 10 * 1000);


		process.on('uncaughtException', (err) => {
			this.error(`UnCaught exception: ${err}\n`);
		});

		process.on('unhandledRejection', (reason, p) => {
			this.error('Unhandled Rejection at:', p, 'reason:', reason);
		});

		this.homey
			.on('unload', () => {
                for (const driver in this.homey.drivers.getDrivers()) {
                    if (driver.worx) {
                        driver.worx.onUnload();
                    } else this.log('app unload called no worx object for', driver);
                };
				this.log('app unload called');
				this.logger.saveLogs();
			})
			.on('memwarn', () => {
				this.log('memwarn!');
			})
			.on('cpuwarn', () => {
				this.log('cpu warning');
		});
	}

	deleteLogs() {
		return this.logger.deleteLogs();
	}

	getLogs() {
		if (this.logger) return this.logger.logArray;
		return ['inactive'];
	}

    clearLogs() {
		if (this.logger) this.logger.logArray = [];
	}

    async initMatrix() {
        this.homey.manifest.flow.triggers.forEach((trigger) => {
            if (trigger.id.includes('_lt') || trigger.id.includes('_gt')) {
                this.updateMatrix(trigger.id);
            }
        });
    }

    async updateMatrix(trigger) {
        const allDrivers = this.homey.drivers.getDrivers();
        Object.values(allDrivers).forEach((driver) => {
            driver.getDevices().forEach((device) => {
                if (!device.triggers) device.triggers = {};  
                this.homey.flow.getDeviceTriggerCard(trigger).getArgumentValues(device)
                    .then(triggers => {
                        if (triggers.length > 0) { 
                            if (!device.triggers.hasOwnProperty(trigger)) device.triggers[trigger] = []; 
                            triggers.forEach(argTrig => {
                                const oldTrig = device.triggers[trigger].find(t => t[Object.keys(argTrig)[0]] === Object.values(argTrig)[0])
                                if (!oldTrig) {
                                    argTrig.trigger = true;
                                    device.triggers[trigger].push(argTrig);
                                    this.log(trigger, 'add', argTrig);
                                } else this.log(trigger, 'old', oldTrig);
                            });
                        }
                    })
                .catch(error => this.log(device.getName(), 'no triggercard found'));
            });
        });
    }

	async registerFlowCards() {
        this.log('registerFlowCards() flows');

        this.trgMower_error = this.homey.flow.getTriggerCard('mower_error')
        this.trgMower_status = this.homey.flow.getTriggerCard('mower_status')
        this.trgMower_error_device = this.homey.flow.getDeviceTriggerCard('mower_error_device')
        this.trgMower_status_device = this.homey.flow.getDeviceTriggerCard('mower_status_device')
        this.trgMower_battery_voltage_changed = this.homey.flow.getDeviceTriggerCard('mower_battery_voltage_changed')
        this.trgMower_battery_voltage_lt = this.homey.flow.getDeviceTriggerCard('mower_battery_voltage_lt')
        this.trgMower_battery_voltage_gt = this.homey.flow.getDeviceTriggerCard('mower_battery_voltage_gt')
        this.trgMower_battery_temperature_changed = this.homey.flow.getDeviceTriggerCard('mower_battery_temperature_changed')
        this.trgMower_battery_temperature_gt = this.homey.flow.getDeviceTriggerCard('mower_battery_temperature_gt')
        this.trgMower_battery_temperature_lt = this.homey.flow.getDeviceTriggerCard('mower_battery_temperature_lt')
        this.trgMower_gradient_changed = this.homey.flow.getDeviceTriggerCard('mower_gradient_changed')
        this.trgMower_gradient_gt = this.homey.flow.getDeviceTriggerCard('mower_gradient_gt')
        this.trgMower_gradient_lt = this.homey.flow.getDeviceTriggerCard('mower_gradient_lt')
        this.trgMower_inclination_changed = this.homey.flow.getDeviceTriggerCard('mower_inclination_changed')
        this.trgMower_inclination_gt = this.homey.flow.getDeviceTriggerCard('mower_inclination_gt')
        this.trgMower_inclination_lt = this.homey.flow.getDeviceTriggerCard('mower_inclination_lt')
        this.trgMower_partyMode_on = this.homey.flow.getDeviceTriggerCard('mower_partyMode_on')
        this.trgMower_partyMode_off = this.homey.flow.getDeviceTriggerCard('mower_partyMode_off')
        this.trgMower_bwt_gt = this.homey.flow.getDeviceTriggerCard('mower_bwt_gt')
        this.trgMower_gpssignal_gt = this.homey.flow.getDeviceTriggerCard('mower_gps_signal_gt')
        this.trgMower_gpssignal_lt = this.homey.flow.getDeviceTriggerCard('mower_gps_signal_lt')
        this.trgMower_gpsaccuracy_gt = this.homey.flow.getDeviceTriggerCard('mower_gps_accuracy_gt')
        this.trgMower_gpsaccuracy_lt = this.homey.flow.getDeviceTriggerCard('mower_gps_accuracy_lt')
        this.trgMower_chargeCurrent_gt = this.homey.flow.getDeviceTriggerCard('mower_chargeCurrent_gt')
        this.trgMower_chargeCurrent_lt = this.homey.flow.getDeviceTriggerCard('mower_chargeCurrent_lt')
        this.trgMower_chargeVolt_gt = this.homey.flow.getDeviceTriggerCard('mower_chargeVolt_gt')
        this.trgMower_chargeVolt_lt = this.homey.flow.getDeviceTriggerCard('mower_chargeVolt_lt')
        this.trgMower_esc_gt = this.homey.flow.getDeviceTriggerCard('mower_temp_esc_gt')
        this.trgMower_esc_lt = this.homey.flow.getDeviceTriggerCard('mower_temp_esc_lt')
        this.trgMower_escLeft_gt = this.homey.flow.getDeviceTriggerCard('mower_temp_escLeft_gt')
        this.trgMower_escLeft_lt = this.homey.flow.getDeviceTriggerCard('mower_temp_escLeft_lt')
        this.trgMower_escRight_gt = this.homey.flow.getDeviceTriggerCard('mower_temp_escRight_gt')
        this.trgMower_escRight_lt = this.homey.flow.getDeviceTriggerCard('mower_temp_escRight_lt')
        this.trgMower_escMotor_gt = this.homey.flow.getDeviceTriggerCard('mower_temp_escMotor_gt')
        this.trgMower_escMotor_lt = this.homey.flow.getDeviceTriggerCard('mower_temp_escMotor_lt')


        this.conMower_AtHome = this.homey.flow.getConditionCard('mower_AtHome')
        this.conMower_PartyMode = this.homey.flow.getConditionCard('mower_PartyMode')
        this.conMower_Error = this.homey.flow.getConditionCard('mower_condition_Error')
        this.conMower_Status = this.homey.flow.getConditionCard('mower_condition_Status')       

        this.actMower_command = this.homey.flow.getActionCard('mower_command')
        this.actMower_zone = this.homey.flow.getActionCard('mower_zone')
        this.actMower_zonePercentages = this.homey.flow.getActionCard('mower_zonePercentages')

        this.log('registerFlowCards() Listeners');

        this.trgMower_error
            .registerArgumentAutocompleteListener('errorCodes', async ( query, args ) => {
                let argErrorCodes;
                this.log(args.device.driver.server )
                if (args.device.driver.server !== 'openmower') {  
                    argErrorCodes = Object.keys(ERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`ERRORCODES.${p}`)
                    }));
                } else {
                    argErrorCodes = Object.keys(OMERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMERRORCODES.${p}`)
                    }));                    
                }
                return argErrorCodes;
            })
            .registerRunListener(async (args, state) => {
                if(args.device.getData().serial != state.serial) return false;
                if (String(args.errorCodes.id) == '99' && String(state.errorCode) != '0') return true; 
                return (String(state.errorCode) === String(args.errorCodes.id));
            });

        this.trgMower_error_device
            .registerArgumentAutocompleteListener('errorCodes', async ( query, args ) => {
                let argErrorCodes;
                if (args.device.driver.server !== 'openmower') {  
                    argErrorCodes = Object.keys(ERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`ERRORCODES.${p}`)
                    }));
                } else {
                    argErrorCodes = Object.keys(OMERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMERRORCODES.${p}`)
                    })); 
                }
                return argErrorCodes;
            })
            .registerRunListener(async (args, state) => {
                if (String(args.errorCodes.id) == '99' && String(state.errorCode) != '0') return true; 
                return (String(state.errorCode) === String(args.errorCodes.id));
            });

        this.trgMower_status
            .registerArgumentAutocompleteListener('statusCodes', async ( query, args ) => {
                let argStatusCodes;
                if (args.device.driver.server !== 'openmower') { 
                    argStatusCodes = Object.keys(STATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`STATUSCODES.${p}`)
                    }));
                } else {
                    argStatusCodes = Object.keys(OMSTATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMSTATUSCODES.${p}`)
                    }));                   
                }
                return argStatusCodes;
            })
            .registerRunListener(async (args, state) => {
                if(args.device.getData().serial != state.serial) return false;
                if (String(args.statusCodes.id) == '99') return true; 
                return (String(state.statusCode) === String(args.statusCodes.id));
            });
        
        this.trgMower_status_device
            .registerArgumentAutocompleteListener('statusCodes', async ( query, args ) => {
                let argStatusCodes;
                if (args.device.driver.server !== 'openmower') { 
                    argStatusCodes = Object.keys(STATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`STATUSCODES.${p}`)
                    }));
                } else {
                    argStatusCodes = Object.keys(OMSTATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMSTATUSCODES.${p}`)
                    }));                   
                }
                return argStatusCodes;
            })
            .registerRunListener(async (args, state) => {
                if (String(args.statusCodes.id) == '99') return true;  
                return (String(state.statusCode) === String(args.statusCodes.id));
            });

        this.trgMower_battery_voltage_changed
            .registerRunListener(async (args, state) => {
                return true;
            });

        this.trgMower_battery_voltage_gt
            .registerRunListener(async (args, state) => {
                return (state.mowerBatteryVoltage === args.mowerBatteryVoltage);
            })
            .on('update', () => {
                this.updateMatrix('mower_battery_voltage_gt');
            }
            );

        this.trgMower_battery_voltage_lt
            .registerRunListener(async (args, state) => {
                return (state.mowerBatteryVoltage === args.mowerBatteryVoltage);
            })
            .on('update', () => {
                this.updateMatrix('mower_battery_voltage_lt');
            });

        this.trgMower_battery_temperature_changed
            .registerRunListener(async (args, state) => {
                return true;
            });

        this.trgMower_battery_temperature_gt
            .registerRunListener(async (args, state) => {
                return (state.mowerBatteryTemperature === args.mowerBatteryTemperature);
            })
            .on('update', () => {
                this.updateMatrix('mower_battery_temperature_gt');
            });

        this.trgMower_battery_temperature_lt
            .registerRunListener(async (args, state) => {
                return (state.mowerBatteryTemperature === args.mowerBatteryTemperature);
            })
            .on('update', () => {
                this.updateMatrix('mower_battery_temperature_lt');
            });

        this.trgMower_gradient_changed
        .registerRunListener(async (args, state) => {
            return true;
            });

        this.trgMower_gradient_gt
            .registerRunListener(async (args, state) => {
                return (state.mowerGradient === args.mowerGradient);
            })
            .on('update', () => {
                this.updateMatrix('mower_gradient_gt');
            });

        this.trgMower_gradient_lt
            .registerRunListener(async (args, state) => {
                return (state.mowerGradient === args.mowerGradient);
            })
            .on('update', () => {
                this.updateMatrix('mower_gradient_lt');
            });

        this.trgMower_inclination_changed
            .registerRunListener(async (args, state) => {
            return true;
            });

        this.trgMower_inclination_gt
            .registerRunListener(async (args, state) => {
                return (state.mowerInclination === args.mowerInclination);
            })
            .on('update', () => {
                this.updateMatrix('mower_inclination_gt');
            });

        this.trgMower_inclination_lt
            .registerRunListener(async (args, state) => {
                return (state.mowerInclination === args.mowerInclination);
            })
            .on('update', () => {
                this.updateMatrix('mower_inclination_lt');
            });   
            
        this.trgMower_bwt_gt
            .registerRunListener(async (args, state) => {
                return (state.mowerBladeHours === args.mowerBladeHours);
            })
            .on('update', () => {
                this.updateMatrix('mower_bwt_gt');
            });

        this.trgMower_gpsaccuracy_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerGPSAccuracy === args.openmowerGPSAccuracy);
            })
            .on('update', () => {
                this.updateMatrix('mower_gps_accuracy_lt');
            });

        this.trgMower_gpsaccuracy_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerGPSAccuracy === args.openmowerGPSAccuracy);
            })
            .on('update', () => {
                this.updateMatrix('mower_gps_accuracy_gt');
            });
        
        this.trgMower_gpssignal_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerGPSAccuracy === args.openmowerGPSAccuracy);
            })
            .on('update', () => {
                this.updateMatrix('mower_gps_signal_lt');
            });

        this.trgMower_gpssignal_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerGPSAccuracy === args.openmowerGPSAccuracy);
            })
            .on('update', () => {
                this.updateMatrix('mower_gps_signal_gt');
            });

        this.trgMower_esc_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESC === args.openmowerTempESC);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_esc_lt');
            });

        this.trgMower_esc_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESC === args.openmowerTempESC);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_esc_gt');
            });

        this.trgMower_escLeft_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCLeft === args.openmowerTempESCLeft);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escLeft_lt');
            });

        this.trgMower_escLeft_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCLeft === args.openmowerTempESCLeft);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escLeft_gt');
            });

        this.trgMower_escRight_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCRight === args.openmowerTempESCRight);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escRight_lt');
            });

        this.trgMower_escRight_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCRight === args.openmowerTempESCRight);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escRight_gt');
            });

        this.trgMower_escMotor_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCMotor === args.openmowerTempESCRight);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escMotor_lt');
            });

        this.trgMower_escMotor_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerTempESCMotor === args.openmowerTempESCMotor);
            })
            .on('update', () => {
                this.updateMatrix('mower_temp_escMotor_gt');
            });
          
        this.trgMower_chargeCurrent_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerChargeCurrent === args.openmowerChargeCurrent);
            })
            .on('update', () => {
                this.updateMatrix('mower_chargeCurrent_lt');
            });

        this.trgMower_chargeCurrent_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerChargeCurrent === args.openmowerChargeCurrent);
            })
            .on('update', () => {
                this.updateMatrix('mower_chargeCurrent_gt');
            });
            
        this.trgMower_chargeVolt_lt
            .registerRunListener(async (args, state) => {
                return (state.openmowerChargeVolt === args.openmowerChargeVolt);
            })
            .on('update', () => {
                this.updateMatrix('mower_chargeVolt_lt');
            });

        this.trgMower_chargeVolt_gt
            .registerRunListener(async (args, state) => {
                return (state.openmowerChargeVolt === args.openmowerChargeVolt);
            })
            .on('update', () => {
                this.updateMatrix('mower_chargeVolt_gt');
            });

        //ACTIONS

        this.actMower_command
            .registerArgumentAutocompleteListener('commandCodes', async ( query, args ) => {
                let argCommandCodes;
                if (args.device.driver.server !== 'openmower') {
                    argCommandCodes = Object.keys(COMMANDCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`COMMANDCODES.${p}`)
                    }));
                } else {
                    argCommandCodes = Object.keys(OMCOMMANDCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMCOMMANDCODES.${p}`)
                    }));                    
                }
                return argCommandCodes;
            })
            .registerRunListener(async (args, state) => {
                this.log('Action card command', args.commandCodes);
                if (args.device.driver.server !== 'openmower') {
                    if (Number(args.commandCodes.id) < 90) this.executeCommand(args.device, {id: args.commandCodes.id, name: `From action Flow ${args.commandCodes.name}`});
                    else if (args.commandCodes.id === '90') this.executeEdgecut(args.device);
                    else if (args.commandCodes.id === '91') this.executePartyMode(args.device, true);
                    else if (args.commandCodes.id === '92') this.executePartyMode(args.device, false);
                    return true;
                } else {
                    return args.device.processCommand(args.commandCodes);
                }
            });

        this.actMower_zone
            .registerArgumentAutocompleteListener('zone', async ( query, args ) => {
                const argZones = [];
                for (let x = 0; x < args.device.numberZones; x++) {
                    argZones.push({ id: x, name: `Zone-${x + 1}`});
                }
                return argZones;
            })
            .registerRunListener(async (args, state) => {
                this.log('Action card set zone 100%', args.zone.id, args.zone.name);
                const percentageZones = [0, 0, 0, 0];
                percentageZones[args.zone.id] = 100;
                this.executeZoneSequence(args.device, percentageZones)
                return true;
            });

        this.actMower_zonePercentages
            .registerRunListener(async (args, state) => {
                this.log('Action card set zone distribution%', args.zone1Percentage, args.zone2Percentage, args.zone3Percentage, args.zone4Percentage);
                if ((args.zone1Percentage + args.zone2Percentage + args.zone3Percentage + args.zone4Percentage) !== 100) {
                    throw 'Total zone percentages is not equal 100%'
                }
                if (args.device.numberZones === 1 && (args.zone2Percentage + args.zone3Percentage + args.zone4Percentage) !== 0) throw 'Zone 2-4 percentages is not equal 0%'
                if (args.device.numberZones === 2 && (args.zone3Percentage + args.zone4Percentage) !== 0) throw 'Zone 3-4 percentages is not equal 0%'
                if (args.device.numberZones === 3 && (args.zone4Percentage) !== 0) throw 'Zone 4 percentages is not equal 0%'

                const percentageZones = [args.zone1Percentage, args.zone2Percentage, args.zone3Percentage, args.zone4Percentage];
                this.executeZoneSequence(args.device, percentageZones)
                return true;
            });

        //CONDITIONS

        this.conMower_AtHome.registerRunListener(async (args, state) => {
            return(args.device.mowerAtHome)
        });

        this.conMower_PartyMode.registerRunListener(async (args, state) => {
            return(args.device.getCapabilityValue('mowerPartyMode'))
        });

        this.conMower_Error
            .registerArgumentAutocompleteListener('errorCodes', async ( query, args ) => {
                let argErrorCodes;
                if (args.device.driver.server !== 'openmower') {            
                    argErrorCodes = Object.keys(ERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`ERRORCODES.${p}`)
                    }));
                }   else {
                    argErrorCodes = Object.keys(OMERRORCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMERRORCODES.${p}`)
                    }));
                }
                return argErrorCodes;
            })
            .registerRunListener(async (args, state) => {
                const status = args.device.getCapabilityValue('mowerError');
                return (args.errorCodes.name === status);
            });

        this.conMower_Status
            .registerArgumentAutocompleteListener('statusCodes', async ( query, args ) => {
                let argStatusCodes;
                if (args.device.driver.server !== 'openmower') {
                    argStatusCodes = Object.keys(STATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`STATUSCODES.${p}`)
                    }));
                } else {
                    argStatusCodes = Object.keys(OMSTATUSCODES).map(p => ({
                        id: p,
                        name : this.homey.__(`OMSTATUSCODES.${p}`)
                    }));                    
                }
                return argStatusCodes;
            })
            .registerRunListener(async (args, state) => {
                const status = args.device.getCapabilityValue('mowerState');
                this.log(args.statusCodes.name, status, (args.statusCodes.name === status));
                return (args.statusCodes.name === status);
            });

    }

	async executeCommand(mowerDev, commandCodes) {
        const command = `{ "cmd": ${commandCodes.id} }`;
        if (commandCodes.id === 0) {
            this.log('executeCommand', mowerDev.getData().serial, 'sendPing');
            for (const mower of mowerDev.driver.mowers) {
                if (mower.serial_number == mowerDev.getData().serial) mowerDev.driver.worx.sendPing(mower);
            };            
        } else {
            this.log('executeCommand', mowerDev.getData().serial, commandCodes.id, commandCodes.name, command);
            mowerDev.driver.worx.sendMessage(command, mowerDev.getData().serial);
        }
    };

    async executeEdgecut(mowerDev) {
        let command;
        if (mowerDev.vision === true) {
            command = '{"sc":{"time":0, "once":{"cfg":{"cut":{"b":1, "z":[]}}}}}';
        } else {
            command = '{"sc":{"ots":{"bc":1,"wtm":0}}}';
        }

        this.log('executeEdgecut', mowerDev.getData().serial);
        mowerDev.driver.worx.sendMessage(command, mowerDev.getData().serial)
    }

    async executePartyMode(mowerDev, on) {
        let command;
        if (mowerDev.vision === true) {
            command = '{"sc":{ "enabled" : 0 }}';
            if (on) command = '{"sc":{ "enabled" : 1 }}';
        } else {
            command = '{"sc":{ "m":1, "distm": 0}}';
            if (on) command = '{"sc":{ "m":2, "distm": 0}}';
        }

        this.log('executePartyMode', on, mowerDev.getData().serial);
        mowerDev.driver.worx.sendMessage(command, mowerDev.getData().serial)
    }

    async executeZoneSequence(mowerDev, percentageZones) {
        let seq = [];
        for (let index = 0; index < 10; index++) {
            percentageZones.forEach(zone => {
                if (zone > 0) {
                    seq.push(percentageZones.indexOf(zone));
                    percentageZones[percentageZones.indexOf(zone)] = zone - 10;
                }
            });
        }
        let command = `{"mzv": ${JSON.stringify(seq)} }`;
        this.log('executeZoneSequence', mowerDev.getData().serial, JSON.stringify(seq));
        mowerDev.driver.worx.sendMessage(command, mowerDev.getData().serial)
    }

}

module.exports = WorxApp;
