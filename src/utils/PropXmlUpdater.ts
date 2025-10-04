import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';
import { DataSourceMeta } from '../project/nc-home/config/NCHomeConfigTypes';

/**
 * prop.xml文件更新工具类
 */
export class PropXmlUpdater {
    /**
     * 更新prop.xml文件中的数据源信息
     * @param homePath NC HOME路径
     * @param dataSource 要添加或更新的数据源
     * @param isUpdate 是否为更新操作（true为更新，false为添加）
     */
    public static updateDataSourceInPropXml(homePath: string, dataSource: DataSourceMeta, isUpdate: boolean = false): void {
        const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');

        // 确保目录存在
        const propDir = path.dirname(propXmlPath);
        if (!fs.existsSync(propDir)) {
            fs.mkdirSync(propDir, { recursive: true });
        }

        let content: string;

        // 如果文件不存在，创建一个基础的prop.xml文件
        if (!fs.existsSync(propXmlPath)) {
            content = this.createBasicPropXmlContent();
        } else {
            // 读取现有文件内容（使用gb2312编码）
            const buffer = fs.readFileSync(propXmlPath);
            content = iconv.decode(buffer, 'gb2312');
        }

        // 生成数据源XML片段
        const dataSourceXml = this.generateDataSourceXml(dataSource);

        if (isUpdate) {
            // 更新操作：替换现有的数据源
            const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>${dataSource.name}</dataSourceName>[\\s\\S]*?</dataSource>`, 'g');
            if (dataSourceRegex.test(content)) {
                // 如果找到了同名数据源，则替换
                content = content.replace(dataSourceRegex, dataSourceXml);
            }
            // 如果没找到，不添加新的数据源，因为这应该是更新操作
        } else {
            // 添加操作：检查是否已存在同名数据源
            const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>${dataSource.name}</dataSourceName>[\\s\\S]*?</dataSource>`, 'g');
            if (dataSourceRegex.test(content)) {
                throw new Error(`数据源 "${dataSource.name}" 已存在`);
            }
            // 添加新的数据源
            content = this.insertDataSourceIntoContent(content, dataSourceXml);
        }

        // 写入文件（使用gb2312编码）
        const buffer = iconv.encode(content, 'gb2312');
        fs.writeFileSync(propXmlPath, buffer);
    }

    /**
     * 从prop.xml文件中删除数据源
     * @param homePath NC HOME路径
     * @param dataSourceName 要删除的数据源名称
     */
    public static removeDataSourceFromPropXml(homePath: string, dataSourceName: string): void {
        const propXmlPath = path.join(homePath, 'ierp', 'bin', 'prop.xml');

        // 检查文件是否存在
        if (!fs.existsSync(propXmlPath)) {
            return;
        }

        // 读取文件内容（使用gb2312编码）
        const buffer = fs.readFileSync(propXmlPath);
        let content = iconv.decode(buffer, 'gb2312');

        // 删除指定的数据源
        const dataSourceRegex = new RegExp(`<dataSource>\\s*<dataSourceName>${dataSourceName}</dataSourceName>[\\s\\S]*?</dataSource>\\s*`, 'g');
        content = content.replace(dataSourceRegex, '');

        // 写入文件（使用gb2312编码）
        const newBuffer = iconv.encode(content, 'gb2312');
        fs.writeFileSync(propXmlPath, newBuffer);
    }

    /**
     * 创建基础的prop.xml内容
     */
    private static createBasicPropXmlContent(): string {
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

    /**
     * 生成数据源XML片段
     * @param dataSource 数据源信息
     */
    private static generateDataSourceXml(dataSource: DataSourceMeta): string {
        // 根据数据库类型生成URL
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
                default:
                    databaseUrl = `jdbc:${dataSource.databaseType.toLowerCase()}://${dataSource.host}:${dataSource.port}/${dataSource.databaseName}`;
            }
        }

        // 根据数据库类型获取驱动类名
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
                default:
                    driverClassName = 'com.mysql.cj.jdbc.Driver';
            }
        }

        return `	<dataSource>
		<dataSourceName>${dataSource.name}</dataSourceName>
		<oidMark>${dataSource.oidFlag || 'ZZ'}</oidMark>
		<databaseUrl>${databaseUrl}</databaseUrl>
		<user>${dataSource.username}</user>
		<password>${dataSource.password}</password>
		<driverClassName>${driverClassName}</driverClassName>
		<databaseType>${dataSource.databaseType.toUpperCase()}</databaseType>
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

    /**
     * 将数据源插入到prop.xml内容中合适的位置
     * @param content 原始内容
     * @param dataSourceXml 数据源XML片段
     */
    private static insertDataSourceIntoContent(content: string, dataSourceXml: string): string {
        // 查找插入位置 - 在</XADataSourceClass>标签之后插入
        const xaDataSourceClassIndex = content.indexOf('</XADataSourceClass>');
        if (xaDataSourceClassIndex !== -1) {
            const insertPosition = xaDataSourceClassIndex + '</XADataSourceClass>'.length;
            return content.slice(0, insertPosition) + '\n' + dataSourceXml + '\n' + content.slice(insertPosition);
        }

        // 如果找不到XADataSourceClass标签，则在文件末尾插入（在</root>标签之前）
        const rootEndIndex = content.lastIndexOf('</root>');
        if (rootEndIndex !== -1) {
            return content.slice(0, rootEndIndex) + '\n' + dataSourceXml + '\n' + content.slice(rootEndIndex);
        }

        // 如果还是找不到合适的位置，直接追加
        return content + '\n' + dataSourceXml;
    }
}