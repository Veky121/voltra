// Adapt the pinned release's defaults without rewriting upstream files or
// existing instance settings.
import InstanceManager from '../node_modules/@clusterio/controller/dist/node/src/InstanceManager.js';
import {bootstrap} from '../node_modules/@clusterio/controller/dist/node/controller.js';
import {configureControllerDefaults} from './clusterio-start.mjs';
configureControllerDefaults(InstanceManager);
bootstrap();
