"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropXmlUpdater = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const iconv = __importStar(require("iconv-lite"));
const PasswordEncryptor_1 = require("./PasswordEncryptor");
class PropXmlUpdater {
    static updateDataSourceInPropXml(homePath, dataSource, isUpdate = false) {
        const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
        const propDir = path.dirname(propXmlPath);
        if (!fs.existsSync(propDir)) {
            fs.mkdirSync(propDir, { recursive: true });
        }
        let content;
        if (!fs.existsSync(propXmlPath)) {
            content = this.createBasicPropXmlContent();
        }
        else {
            const buffer = fs.readFileSync(propXmlPath);
            try {
                content = iconv.decode(buffer, 'gb2312');
            }
            catch (error) {
                console.warn('gb2312解码失败，尝试使用UTF-8解码:', error);
                content = iconv.decode(buffer, 'utf8');
            }
        }
        const dataSourceXml = this.generateDataSourceXml(homePath, dataSource);
        if (isUpdate) {
            const escapedName = this.escapeRegExp(dataSource.name);
            const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>\\s*${escapedName}\\s*</dataSourceName>[\\s\\S]*?</dataSource>`, 'g');
            if (dataSourceRegex.test(content)) {
                content = content.replace(dataSourceRegex, '\n' + dataSourceXml + '\n');
            }
        }
        else {
            const escapedName = this.escapeRegExp(dataSource.name);
            const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>\\s*${escapedName}\\s*</dataSourceName>[\\s\\S]*?</dataSource>`, 'g');
            if (dataSourceRegex.test(content)) {
                throw new Error(`数据源 "${dataSource.name}" 已存在`);
            }
            content = this.insertDataSourceIntoContent(content, dataSourceXml);
        }
        const buffer = iconv.encode(content, 'gb2312', { addBOM: false });
        fs.writeFileSync(propXmlPath, buffer);
    }
    static removeDataSourceFromPropXml(homePath, dataSourceName) {
        const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
        if (!fs.existsSync(propXmlPath)) {
            return;
        }
        const buffer = fs.readFileSync(propXmlPath);
        let content;
        try {
            content = iconv.decode(buffer, 'gb2312');
        }
        catch (error) {
            console.warn('gb2312解码失败，尝试使用UTF-8解码:', error);
            content = iconv.decode(buffer, 'utf8');
        }
        const escapedName = this.escapeRegExp(dataSourceName);
        const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>\\s*${escapedName}\\s*</dataSourceName>[\\s\\S]*?</dataSource>\\s*`, 'g');
        content = content.replace(dataSourceRegex, '');
        const newBuffer = iconv.encode(content, 'gb2312', { addBOM: false });
        fs.writeFileSync(propXmlPath, newBuffer);
    }
    static createBasicPropXmlContent() {
        return `<?xml version="1.0" encoding='gb2312'?>
<root ClassType="com.yonyou.util.prop.PropInfo">
	<enableHotDeploy>false</enableHotDeploy>
	<domain>
		<server>
			<javaHome>$JAVA_HOME</javaHome>
			<name>server</name>
			<jvmArgs>-server -Xmx4096m -XX:MetaspaceSize=512m    -XX:MaxMetaspaceSize=1024m   -Dsun.reflect.noInflation=true  -Dsun.reflect.inflationThreshold=0 -Djava.awt.headless=true -Duser.timezone=GMT+8  -Dlog4j.ignoreTCL=true -Dfile.encoding=UTF-8 -Dlog4j2.formatMsgNoLookups=true -Djava.lang.string.substring.nocopy=true</jvmArgs>
			<servicePort>8005</servicePort>
			<http>
				<address>127.0.0.1</address>
				<port>2207</port>
			</http>
		</server>
	</domain>
	<isEncode>true</isEncode>
	<internalServiceArray>
		<name>StartTomcat</name>
		<serviceClassName>nc.bs.tomcat.startup.BootStrapTomcatService</serviceClassName>
		<accessDemandRight>15</accessDemandRight>
		<startService>true</startService>
		<keyService>false</keyService>
		<serviceOptions>start|stop</serviceOptions>
	</internalServiceArray>
	<internalServiceArray>
		<name>EJB_SERVICE</name>
		<serviceClassName>nc.bs.mw.naming.EJBContainerService</serviceClassName>
		<accessDemandRight>15</accessDemandRight>
		<startService>true</startService>
		<keyService>false</keyService>
		<serviceOptions>start|stop</serviceOptions>
	</internalServiceArray>
	<TransactionManagerProxyClass>uap.mw.trans.UAPTransactionManagerProxy</TransactionManagerProxyClass>
	<UserTransactionClass>uap.mw.trans.UAPUserTransanction</UserTransactionClass>
	<TransactionManagerClass>uap.mw.trans.UAPTransactionManager</TransactionManagerClass>
	<SqlDebugSetClass>nc.bs.mw.sql.UFSqlObject</SqlDebugSetClass>
	<XADataSourceClass>uap.mw.ds.UAPDataSource</XADataSourceClass>
	<fdbPath>fdb</fdbPath>
	<tokenSeed>d1acb0a420f0992211a7458f58ea4af5</tokenSeed>
	<priviledgedToken>27b20d315dab342d1a8fc6cb1740078c</priviledgedToken>
	<isTraditionalDeploy>false</isTraditionalDeploy>
	<isTokenBindIP>false</isTokenBindIP>
	<isTokenValidateOn>false</isTokenValidateOn>
	<securityDataSource>design</securityDataSource>
	<maxConcurrentTimes>0</maxConcurrentTimes>
	<overTime>0</overTime>
	<usefulTime>0</usefulTime>
</root>`;
    }
    static generateDataSourceXml(homePath, dataSource) {
        let databaseUrl = dataSource.url || '';
        if (!databaseUrl) {
            switch (dataSource.databaseType.toLowerCase()) {
                case 'mysql':
                case 'mysql5':
                case 'mysql8':
                    databaseUrl = `jdbc:mysql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}?useSSL=false&serverTimezone=UTC`;
                    break;
                case 'oracle':
                case 'oracle11g':
                case 'oracle12c':
                    databaseUrl = `jdbc:oracle:thin:@${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                case 'sqlserver':
                case 'mssql':
                    databaseUrl = `jdbc:sqlserver://${dataSource.host}:${dataSource.port};database=${dataSource.databaseName}`;
                    break;
                case 'postgresql':
                case 'pg':
                    databaseUrl = `jdbc:postgresql://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                case 'dm':
                    databaseUrl = `jdbc:dm://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                case 'kingbase':
                    databaseUrl = `jdbc:kingbase8://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
                    break;
                default:
                    databaseUrl = `jdbc:${dataSource.databaseType.toLowerCase()}://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
            }
        }
        let driverClassName = dataSource.driverClassName || '';
        if (!driverClassName) {
            switch (dataSource.databaseType.toLowerCase()) {
                case 'mysql':
                case 'mysql5':
                case 'mysql8':
                    driverClassName = 'com.mysql.cj.jdbc.Driver';
                    break;
                case 'oracle':
                case 'oracle11g':
                case 'oracle12c':
                    driverClassName = 'oracle.jdbc.OracleDriver';
                    break;
                case 'sqlserver':
                case 'mssql':
                    driverClassName = 'com.microsoft.sqlserver.jdbc.SQLServerDriver';
                    break;
                case 'postgresql':
                case 'pg':
                    driverClassName = 'org.postgresql.Driver';
                    break;
                case 'dm':
                    driverClassName = 'dm.jdbc.driver.DmDriver';
                    break;
                case 'kingbase':
                    driverClassName = 'com.kingbase8.Driver';
                    break;
                default:
                    driverClassName = 'com.mysql.cj.jdbc.Driver';
            }
        }
        let encryptedPassword = dataSource.password || '';
        if (encryptedPassword) {
            try {
                encryptedPassword = PasswordEncryptor_1.PasswordEncryptor.encrypt(homePath, encryptedPassword);
            }
            catch (error) {
                console.error('密码加密失败:', error);
            }
        }
        const escapeXml = (str) => {
            if (!str)
                return str;
            return str.replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&apos;');
        };
        const dataSourceName = dataSource.name || '';
        return `	<dataSource>
		<dataSourceName>${escapeXml(dataSourceName)}</dataSourceName>
		<oidMark>${escapeXml(dataSource.oidFlag || 'ZZ')}</oidMark>
		<databaseUrl>${escapeXml(databaseUrl)}</databaseUrl>
		<user>${escapeXml(dataSource.username)}</user>
		<password>${escapeXml(encryptedPassword)}</password>
		<driverClassName>${escapeXml(driverClassName)}</driverClassName>
		<databaseType>${escapeXml(dataSource.databaseType.toUpperCase())}</databaseType>
		<maxCon>50</maxCon>
		<minCon>1</minCon>
		<dataSourceClassName>nc.bs.mw.ejb.xares.IerpDataSource</dataSourceClassName>
		<xaDataSourceClassName>nc.bs.mw.ejb.xares.IerpXADataSource</xaDataSourceClassName>
		<conIncrement>0</conIncrement>
		<conInUse>0</conInUse>
		<conIdle>0</conIdle>
		<isBase>${dataSource.name === 'design' ? 'true' : 'false'}</isBase>
	</dataSource>`;
    }
    static insertDataSourceIntoContent(content, dataSourceXml) {
        const xaDataSourceClassIndex = content.indexOf('</XADataSourceClass>');
        if (xaDataSourceClassIndex !== -1) {
            const insertPosition = xaDataSourceClassIndex + '</XADataSourceClass>'.length;
            return content.slice(0, insertPosition) + '\n' + dataSourceXml + '\n' + content.slice(insertPosition);
        }
        const rootEndIndex = content.lastIndexOf('</root>');
        if (rootEndIndex !== -1) {
            return content.slice(0, rootEndIndex) + '\n' + dataSourceXml + '\n' + content.slice(rootEndIndex);
        }
        return content + '\n' + dataSourceXml;
    }
    static escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    static updateVmParametersInPropXml(homePath, vmParameters) {
        const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');
        if (!fs.existsSync(propXmlPath)) {
            throw new Error(`prop.xml文件不存在: ${propXmlPath}`);
        }
        const buffer = fs.readFileSync(propXmlPath);
        let content;
        try {
            content = iconv.decode(buffer, 'gb2312');
        }
        catch (error) {
            console.warn('gb2312解码失败，尝试使用UTF-8解码:', error);
            content = iconv.decode(buffer, 'utf8');
        }
        const escapedVmParameters = vmParameters
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        const jvmArgsRegex = /<jvmArgs>([^<]*)<\/jvmArgs>/;
        if (jvmArgsRegex.test(content)) {
            content = content.replace(jvmArgsRegex, `<jvmArgs>${escapedVmParameters}</jvmArgs>`);
        }
        else {
            const serverRegex = /(<server>\s*<javaHome>[^<]*<\/javaHome>\s*<name>[^<]*<\/name>)/;
            if (serverRegex.test(content)) {
                content = content.replace(serverRegex, `$1\n\t\t\t<jvmArgs>${escapedVmParameters}</jvmArgs>`);
            }
            else {
                throw new Error('无法在prop.xml中找到合适的位置插入JVM参数');
            }
        }
        const newBuffer = iconv.encode(content, 'gb2312', { addBOM: false });
        fs.writeFileSync(propXmlPath, newBuffer);
        console.log('Updated JVM parameters in prop.xml:', vmParameters);
    }
}
exports.PropXmlUpdater = PropXmlUpdater;
//# sourceMappingURL=PropXmlUpdater.js.map