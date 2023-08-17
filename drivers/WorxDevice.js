// Device.js
'use strict';

const Homey = require('homey');

class WorxDevice extends Homey.Device {

    
    async onInit() {
        this.log(`Init device ${this.getName()}`);
        this.updated = false;
        this.vision = false;

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
        if (changedKeys.includes('mowerLock')) {            
            if (newSettings.mowerLock === true) {
                this.log('OnSettings() Lock Mower', this.getData().serial);
                this.homey.app.executeCommand(this, {id: '5', name: 'Lock from Device Settings'})
            }
            else {
                this.log('OnSettings() Unlock Mower', this.getData().serial);
                this.homey.app.executeCommand(this, {id: '6', name: 'UnLock from Device Settings'})
            }
        } 
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
            if (this.hasCapability(capability) === false && capability.startsWith('mower') === true && capability.startsWith('mowerZones') === false) {
                this.addCapability(capability)
                this.log('checkCapabilities() added', capability);
            };
        };
    };

    async updateJob(action, statusCode) {
        const startSequence = '2';
        const leavingHome = '3';

        if (action === 'init') {
            this.currentJob = [];
        }
        this.currentJob.push(statusCode);
        if (this.driver.worx.debug) this.log(JSON.stringify(this.currentJob, ' ', 4));
        if (statusCode === '7') { // Mowing
            let statusMsg, statusToken;
            if (!this.currentJob.includes(startSequence)) {
                this.currentJob.push(startSequence);
                this.log('no start sequence status in current job, issuing trigger');
                statusMsg = this.homey.__(`STATUSCODES.${startSequence}`);
                statusToken = {statusCode: startSequence, statusMsg, serial: this.getData().serial};
                this.homey.app.trgMower_status.trigger(statusToken, statusToken).catch(error => {this.error(devName, 'error trigger Status Mower', error)});
            }
            if (!this.currentJob.includes(leavingHome)) {
                this.currentJob.push(leavingHome);
                this.log('no leaving home status in current job, issuing trigger');
                statusMsg = this.homey.__(`STATUSCODES.${leavingHome}`);
                statusToken = {statusCode: leavingHome, statusMsg, serial: this.getData().serial};
                this.homey.app.trgMower_status.trigger(statusToken, statusToken).catch(error => {this.error(devName, 'error trigger Status Mower', error)});
            }
        }
    }

    async updateMower(serial) {
        if (this.updated) return;
        this.updated = true;

        this.log('updateMower()', serial);
        if (this.getCapabilityValue('mowerModel') === null) {
            for (const product of this.driver.worx.products) {
                if (product.id === this.getData().product_id) {
                    this.setCapabilityValue('mowerModel', product.code);
                }
            }
        }

        for (const mower of this.driver.worx.deviceArray) {
            if (mower.serial_number == serial) {
                if (mower.capabilities.includes('vision') === true) {
                    this.log('Vision capable device');
                    this.vision = true;
                }
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
                    this.driver.worx.sendPing(mower);
                    this.driver.setAvailability(mower);
                }
            };
        };

    };

}

module.exports = WorxDevice;