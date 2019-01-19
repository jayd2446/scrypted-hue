import hue from "node-hue-api";
const { HueApi, lightState } = hue;

Error.captureStackTrace = function () {
}

function DeviceProvider() {
    this.devices = {};
};

DeviceProvider.prototype.getDevice = function (id) {
    if (!this.api)
        return null;
    if (!this.devices[id])
        return null;
    return new VirtualDevice(id, this.api, this.devices[id]);
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
        log.i(`Found device: ${JSON.stringify(device)}`);
        if (light.type.toLowerCase().indexOf('color') != -1) {
            device.interfaces.push('ColorSetting');
        }
        devices.push(device);
    }

    deviceManager.onDevicesChanged(payload);
}

var deviceProvider = new DeviceProvider();


function VirtualDevice(id, api, device) {
    this.id = id;
    this.api = api;
    this.device = device;
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
    return true;
}

VirtualDevice.prototype.getTemperatureMinK = function() {
  return Math.round(1 / (this.device.capabilities.control.ct.max) * 1000000);
}

VirtualDevice.prototype.getTemperatureMaxK = function() {
  return Math.round(1 / (this.device.capabilities.control.ct.min) * 1000000);
}

VirtualDevice.prototype.setTemperature = function(kelvin) {
    var mired = Math.round(1 / (kelvin / 1000000));
    this.api.setLightState(this.id, lightState.create().ct(mired));
}

VirtualDevice.prototype.setRgb = function(r, g, b) {
    this.api.setLightState(this.id, lightState.create().rgb(r, g, b));
}

VirtualDevice.prototype.setHsv = function(h, s, v) {
    this.api.setLightState(this.id, lightState.create().hsb(h, s * 100, v * 100));
}

var bridgeId = scriptSettings.getString('bridgeId');
var bridgeAddress = scriptSettings.getString('bridgeAddress');;
if (!bridgeId) {
    log.i('No "bridgeId" was specified in Plugin Settings. Press the pair button on the Hue bridge.');
    log.i('Searching for Hue Bridge...');
}
else {
    var username = scriptSettings.getString(`user-${bridgeId}`);
    if (username) {
        log.i(`Using existing login for bridge ${bridgeId}`);
    }
    else {
        log.i(`No login found for ${bridgeId}. You will need to press the pairing button on your Hue bridge, and the save plugin to reload it.`);
    }
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
            log.e('Please specify which bridge to manage using the Plugin Setting "bridgeId"');
            return;
        }

        bridgeId = bridges[0].id;
        log.i(`Found bridge ${bridgeId}. Setting as default.`);
        scriptSettings.putString('bridgeId', bridgeId);
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
            log.e(`Unable to locate bridge address for bridge: ${bridgeId}.`);
            return;
        }

        log.w('Unable to locate most recent bridge address with nupnp search. using last known address.')
    }
    else {
        bridgeAddress = foundAddress;
    }
    scriptSettings.putString('bridgeAddress', bridgeAddress);

    log.i(`Hue Bridges Found: ${bridgeId}`);
    log.i('Querying devices...');


    async function listDevices(host, username) {
        var api = new HueApi(host, username);
        deviceProvider.api = api;
        try {
            var result = await api.lights();
        }
        catch (e) {
            log.e(`Unable to list devices on bridge ${bridgeId}: ${e}`);
        }
        log.i(`lights: ${result}`);

        for (var light of result.lights) {
            deviceProvider.devices[light.id] = light;
        }
        deviceProvider.updateLights();
    }

    if (username) {
        log.i(`Using existing login for bridge ${bridgeId}`);
        listDevices(bridgeAddress, username);
        return;
    }

    const api = new HueApi();
    api.registerUser(bridgeAddress, 'ScryptedServer')
        .then((result) => {
            log.i(`Created user on ${bridgeId}: ${result}`);
            username = result;
            scriptSettings.putString(`user-${bridgeId}`, result);
            return listDevices(bridgeAddress, username);
        })
        .catch((e) => {
            log.e(`Unable to create user on bridge ${bridgeId}: ${e}`);
            log.e('You may need to press the pair button on the bridge.');
        })
        .done();
};

// --------------------------
// Using a promise
hue.nupnpSearch().then(displayBridges);


export default deviceProvider;
