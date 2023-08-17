/* eslint-disable linebreak-style */
/* eslint-disable indent */
/* eslint-disable no-tabs */
/* eslint-disable max-len */

/*

Based on CaptureLog Robin de Gruijter (gruijter@hotmail.com)

*/

'use strict';

const Homey = require('homey');
const StdOutFixture = require('fixture-stdout');
const fs = require('fs');

class captureLogs {

  // Log object to keep logs in memory and in persistent storage
  // captures and reroutes Homey's this.log (stdout) and this.err (stderr)
	constructor(homey, logName, logLength) {
		this.homey = homey;
		this.logName = logName || 'log';
		this.logLength = logLength || 50;
		this.logFile = `/userdata/${this.logName}.json`;
		this.logArray = [];
		this.getLogs();
		this.captureStdOut();
		this.captureStdErr();
	}

	getLogs() {
		try {
			const log = fs.readFileSync(this.logFile, 'utf8');
			if (Homey) this.logArray = JSON.parse(log);
			this.homey.log('logfile retrieved');
			return this.logArray;
		} 	catch (error) {
				if (error.message.includes('ENOENT')) return [];
				this.homey.error('error parsing logfile: ', error.message);
				return [];
			}
	}

	saveLogs() {
		try {
			fs.writeFileSync(this.logFile, JSON.stringify(this.logArray));
			this.homey.log('logfile saved');
			return true;
		} 	catch (error) {
				this.homey.error('error writing logfile: ', error.message);
				return false;
			}
		}

	deleteLogs() {
		try {
			fs.unlinkSync(this.logFile);
			this.logArray = [];
			this.homey.log('logfile deleted');
			return true;
		} 	catch (error) {
				if (error.message.includes('ENOENT')) return false;
				this.homey.error('error deleting logfile: ', error.message);
				return false;
			}
	}

	captureStdOut() {
		// Capture all writes to stdout (e.g. this.log)
		this.captureStdout = new StdOutFixture({ stream: process.stdout });

		this.captureStdout.capture(string => {
			if (this.logArray.length >= this.logLength) {
				this.logArray.shift();
			}
			this.logArray.push(this.eventDate(string));
		});

		this.homey.log('capturing stdout');
	}

	captureStdErr() {
		// Capture all writes to stderr (e.g. this.error)
		this.captureStderr = new StdOutFixture({ stream: process.stderr });

		this.captureStderr.capture(string => {
			if (this.logArray.length >= this.logLength) {
				this.logArray.shift();
			}
			this.logArray.push(`<td class="table-danger">${string.replace(/\[err]|\[LandroidApp]|\[ManagerDrivers]/gi, '')}</td>`);
		});

		this.homey.log('capturing stderr');
	}

	releaseStdOut() {
		this.captureStdout.release();
	}

	releaseStdErr() {
		this.captureStderr.release();
	}

	eventDate(string) {
		let dUTC;
		let remainder;
		if (string.substring(0, 5) === '[log]') {
			dUTC = new Date(`${string.substring(6, 25)} UTC`);
			remainder = string.substring(26);
		}	else {
			return `<td class="table-warning" style="font-size: smaller">${string}</td>`;
		}
		const timeZone = this.homey.clock.getTimezone();
		let local = dUTC.toLocaleString(undefined, {
			timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
			});

		const dt = local.split(',');

		local = `${dt[0].split('/')[2]}-${dt[0].split('/')[0]}-${dt[0].split('/')[1]} ${dt[1]}`;
		return `<td class="table-secondary" style="font-size: smaller">${local} ${remainder.replace(/\[log]|\[LandroidApp]|\[ManagerDrivers]/gi, '')}</td>`;
	}

}

module.exports = captureLogs;
