import * as api from '@aikdna/kdna-web-client';
import {runMatrix} from './matrix.mjs';
globalThis.runLegacyMatrix=base=>runMatrix(api,base);
