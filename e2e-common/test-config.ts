import { mergeConfig } from '@vendure/core';
import {
    MysqlInitializer,
    PostgresInitializer,
    registerInitializer,
    SqljsInitializer,
    testConfig as defaultTestConfig,
} from '@vendure/testing';
import fs from 'fs-extra';
import path from 'path';
import { DataSourceOptions } from 'typeorm';
import { fileURLToPath } from 'url';

import { getPackageDir } from './get-package-dir';

/**
 * We use a relatively long timeout on the initial beforeAll() function of the
 * e2e tests because on the first run (and always in CI) the sqlite databases
 * need to be generated, which can take a while.
 */
export const TEST_SETUP_TIMEOUT_MS = process.env.E2E_DEBUG ? 1800 * 1000 : 120000;

const packageDir = getPackageDir();

registerInitializer('sqljs', new SqljsInitializer(path.join(packageDir, '__data__')));
registerInitializer('postgres', new PostgresInitializer());
registerInitializer('mysql', new MysqlInitializer());
registerInitializer('mariadb', new MysqlInitializer());

export const testConfig = () => {
    // we use this ports.json file to keep track of which ports are already in use
    // @ts-ignore
    const portsFile = fileURLToPath(new URL('ports.json', import.meta.url));
    let nextPort: number = -1;

    // acquire a lock on ports.json.

    // this mkdir operation will fail if any other process or thread has created
    // a ./__ports_json_lock__ directory and hasn't deleted it yet. creating
    // this directory means claiming the exclusive right to read and modify the
    // ports.json file; if another process has done this, we just have to wait
    // until they delete it. in this way, we can make sure that no two processes
    // are reading and modifying ports.json at once, which can lead to race
    // conditions. (https://github.com/vendure-ecommerce/vendure/issues/3247).

    // this is inspired by https://stackoverflow.com/a/6229247/3962267

    const lockDirectory = path.resolve(__dirname, '__ports_json_lock__');
    while (true) {
        try {
            fs.mkdirSync(lockDirectory);
            break;
        } catch {
            // failed to acquire the lock; retrying
        }
    }

    fs.ensureFileSync(portsFile);
    let usedPorts: number[];
    try {
        usedPorts = fs.readJSONSync(portsFile) ?? [3010];
    } catch (e: any) {
        usedPorts = [3010];
    }
    nextPort = Math.max(...usedPorts) + 1;
    usedPorts.push(nextPort);
    if (100 < usedPorts.length) {
        // reset the used ports after it gets 100 entries long
        usedPorts = [3010];
    }
    fs.writeJSONSync(portsFile, usedPorts);

    // release the lock and let other threads/processes access the ports.json file
    fs.rmdirSync(lockDirectory);

    return mergeConfig(defaultTestConfig, {
        apiOptions: {
            port: nextPort,
        },
        importExportOptions: {
            importAssetsDir: path.join(packageDir, 'fixtures/assets'),
        },
        dbConnectionOptions: getDbConfig(),
    });
};

function getDbConfig(): DataSourceOptions {
    const dbType = process.env.DB || 'sqljs';
    switch (dbType) {
        case 'postgres':
            return {
                synchronize: true,
                type: 'postgres',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_POSTGRES_PORT || 5432) : 5432,
                username: 'vendure',
                password: 'password',
            };
        case 'mariadb':
            return {
                synchronize: true,
                type: 'mariadb',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MARIADB_PORT || 3306) : 3306,
                username: 'vendure',
                password: 'password',
            };
        case 'mysql':
            return {
                synchronize: true,
                type: 'mysql',
                host: '127.0.0.1',
                port: process.env.CI ? +(process.env.E2E_MYSQL_PORT || 3306) : 3306,
                username: 'vendure',
                password: 'password',
            };
        case 'sqljs':
        default:
            return defaultTestConfig.dbConnectionOptions;
    }
}
