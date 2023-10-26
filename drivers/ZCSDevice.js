// Device.js
'use strict';

const Homey = require('homey');

class ZCSDevice extends Homey.Device {
  
    async onInit() {
        this.log(`Init device ${this.getName()}`);
        this.updated = false;

        this.registerCapabilityListener("onoff", async (value, opts) => {
            if (Object.keys(opts).length === 0) {
                // MANUAL IN THE APP
                if (value) this.homey.app.executeCommand(this, {id: '1', name: 'Start from OnOff'})                    
                else this.homey.app.executeCommand(this, {id: '3', name: 'Home from OnOff'})
            }
        });

        
        this.ready().then( () => {
            this.currentJob = [];
            const serial = this.getData().serial;
            this.log(`Device ready: ${this.getName()} - ${serial} `);
            this.homey.setTimeout(() => {
                this.checkCapabilities().then( () => {this.updateMower(serial)});    
            }, 10 * 1000);
                     
        });
         
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.log(changedKeys, oldSettings, newSettings);
      }

    onAdded() {
        const serial = this.getData().serial;
        this.log(`New device added: ${this.getName()} - ${serial} `);
    }

    onDeleted() {
        const serial = this.getData().serial;
        this.log(`Device deleted: ${this.getName()} - ${serial} `);
    }

    async checkCapabilities() {
        for (const capability of Object.keys(this.homey.app.manifest.capabilities)) {
            if (this.hasCapability(capability) === false && capability.startsWith('zcs') === true) {
                this.addCapability(capability)
                this.log('checkCapabilities() added', capability);
            };
        };
    };

    async updateJob(action, statusCode) {
    }

    async updateMower(serial) {
        if (this.updated) return;
        this.updated = true;

        this.log('updateMower()', serial);
        if (this.getCapabilityValue('mowerModel') === null) {
            for (const product of this.driver.ZCS.products) {
                if (product.id === this.getData().product_id) {
                    this.setCapabilityValue('mowerModel', product.code);
                }
            }
        }

        for (const mower of this.driver.ZCS.deviceArray) {
            if (mower.serial_number == serial) {
                if ('lawn_size' in mower && this.getCapabilityValue('mowerLawnsize') === null) this.setCapabilityValue('mowerLawnsize', mower.lawn_size);
                let bwt;
                if ('blade_work_time' in mower) bwt = Math.round(mower.blade_work_time/60);
                if ('blade_work_time_reset' in mower && 'blade_work_time_reset' !== null) bwt = Math.round((mower.blade_work_time - mower.blade_work_time_reset)/60);
                if ('blade_work_time' in mower && this.getCapabilityValue('mowerBladetime') === null) this.setCapabilityValue('mowerBladetime', bwt);
                if ('distance_covered' in mower && this.getCapabilityValue('mowerDistance') === null) this.setCapabilityValue('mowerDistance', Math.round(mower.distance_covered/1000)); 
                this.setSettings({mowerSerialnumber: serial.toString()});
                if ('locked' in mower) this.setSettings({mowerLock: mower.locked});
                if ('messageData' in mower) this.driver.updateStatus(mower, mower.messageData); // device has been deleted and added in same session
                else {
                    this.driver.setAvailability(mower);
                }
            };
        };

    };

}

module.exports = ZCSDevice;