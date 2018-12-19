import hue from "node-hue-api";
const { HueApi, lightState } = hue;

Error.captureStackTrace = function () {
}

function DeviceProvider() {
    this.devices = {};
};

DeviceProvider.prototype.getDevice = function (id) {
    if (!this.api)
        return null;;
    return new VirtualDevice(id, this.api);
}

DeviceProvider.prototype.updateLights = function () {
    var devices = [];
    var payload = {
        devices: devices,
    };

    for (var light in this.devices) {
        light = this.devices[light];
        var device = {
            id: light.id,
            name: light.name,
            interfaces: ['OnOff', 'Brightness'],
            type: 'Light',
        };
        if (light.type.toLowerCase().indexOf('color') != -1) {
            device.interfaces.push('ColorSetting');
        }
        devices.push(device);
    }

    deviceManager.onDevicesChanged(payload);
}

var deviceProvider = new DeviceProvider();


function VirtualDevice(id, api) {
    this.id = id;
    this.api = api;
}

// implementation of OnOff

VirtualDevice.prototype.isOn = function () {
    return true;
};

VirtualDevice.prototype.turnOff = function () {
    this.api.setLightState(this.id, lightState.create().turnOff());
};

VirtualDevice.prototype.turnOn = function () {
    this.api.setLightState(this.id, lightState.create().turnOn());
};

// implementation of Brightness

VirtualDevice.prototype.setLevel = function(level) {
    this.api.setLightState(this.id, lightState.create().brightness(level));
}

VirtualDevice.prototype.getLevel = function() {
    return 100;
}

// implementation of ColorSetting

VirtualDevice.prototype.supportsSpectrumRgb = function() {
    return true;
}

VirtualDevice.prototype.supportsSpectrumHsv = function() {
    return true;
}

VirtualDevice.prototype.supportsTemperature = function() {
    return false;
}

VirtualDevice.prototype.setRgb = function(r, g, b) {
    this.api.setLightState(this.id, lightState.create().rgb(r, g, b));
}

VirtualDevice.prototype.setHsv = function(h, s, v) {
    this.api.setLightState(this.id, lightState.create().hsb(h, s * 100, v * 100));
}

var bridgeId = scriptConfiguration.getString('bridgeId');
var bridgeAddress = scriptConfiguration.getString('bridgeAddress');;
if (!bridgeId) {
    log.i('No "bridgeId" was specified in Script Settings. Checking for default if one exists.');
}

var displayBridges = function (bridges) {
    if (!bridgeId) {
        if (bridges.length == 0) {
            log.e('No Hue bridges found');
            return;
        }
        else if (bridges.length != 1) {
            log.e('Multiple hue bridges found: ');
            for (var found of bridges) {
                log.e(found.id);
            }
            log.e('Please specify which bridge to manage using the Script Setting "bridgeId"');
            return;
        }

        bridgeId = bridges[0].id;
    }

    var foundAddress;
    for (var found of bridges) {
        if (found.id == bridgeId) {
            foundAddress = found.ipaddress;
            break;
        }
    }

    if (!foundAddress) {
        if (!bridgeAddress) {
            log.e('Unable to locate bridge address.');
            return;
        }

        log.w('Unable to locate most recent bridge address with nupnp search. using last known address.')
    }
    else {
        bridgeAddress = foundAddress;
    }
    scriptConfiguration.putString('bridgeAddress', bridgeAddress);

    log.i(`Hue Bridges Found: ${bridgeId}`);
    log.i('Querying devices...');


    async function listDevices(host, username) {
        var api = new HueApi(host, username);
        deviceProvider.api = api;
        var result = await api.lights();
        log.i(`lights: ${result}`);

        for (var light of result.lights) {
            deviceProvider.devices[light.id] = light;
            // var lightResult = await api.setLightState(parseInt(light.id), lightState.create().on().rgb(255, 0, 0));
            // log.i(`light set: ${lightResult}`);
        }
        deviceProvider.updateLights();
    }

    var username = scriptConfiguration.getString(`user-${bridgeId}`);
    if (username) {
        log.i(`Using existing login for bridge ${bridgeId}`);
        listDevices(bridgeAddress, username);
        return;
    }

    log.i(`No login found for ${bridgeId}. Creating new user. You may need to press the pairing button on your Hue bridge, and then save this script to reload it.`);
    const api = new HueApi();
    api.registerUser(bridgeAddress, 'ScryptedServer')
        .then((result) => {
            log.i(`Created user ${result}`);
            username = result;
            scriptConfiguration.putString(`user-${bridgeId}`, result);
            listDevices(bridgeAddress, username);
        })
        .fail((e) => {
            log.e(`error creating user: ${e}`);
        })
        .done();
};

// --------------------------
// Using a promise
hue.nupnpSearch().then(displayBridges).done();


exports.result = deviceProvider;
