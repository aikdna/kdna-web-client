import {fixture} from './fixture.mjs';
import {writeFileSync} from 'node:fs';
writeFileSync(new URL('../../fixtures/valid.kdna',import.meta.url),fixture(2));
writeFileSync(new URL('../../fixtures/other.kdna',import.meta.url),fixture(2,p=>{p.judgments[0].result.value.value='OTHER';}));

writeFileSync(new URL('../../fixtures/encrypted.kdna',import.meta.url),fixture(1,()=>{},[],m=>{m.payload.encrypted=true;}));
