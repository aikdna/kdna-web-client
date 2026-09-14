import api = require('@aikdna/kdna-web-client');
const operation:Promise<api.SelectionResult>=api.selectKDNA(new Uint8Array());
void operation;
