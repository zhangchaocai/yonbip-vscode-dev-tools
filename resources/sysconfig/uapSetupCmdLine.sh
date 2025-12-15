#!/bin/sh
###############################################
# Purpose: NC application tool for configuration environment variable
# Author:  UFIDA, zhangwei@ufida.com.cn 
###############################################

# 安全设置 ulimit（避免报错）
ulimit -n 65535 2>/dev/null || ulimit -n 10240 2>/dev/null || true

# 使用 uname（不带 /bin/）
PLATFORM=$(uname)
ARCH=$(uname -m)

# 兼容 macOS 的 SCRIPT_DIR 获取方式
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "${NC_HOME}" = "" ]; then
    cd "${SCRIPT_DIR}"
    BIN_HOME=$(pwd)
    cd "${BIN_HOME}/.."
    NC_HOME=$(pwd)
fi

ANT_HOME="${NC_HOME}/ant"
NC_JAVA_HOME="${NC_HOME}/ufjdk"
BIN_HOME="${NC_HOME}/bin"
TOMCAT_HOME="${NC_HOME}"
ANT_OPTS="-Xmx512m "

NC_LOGIN_JAR_CONF="${NC_HOME}/ierp/bin/jarversion.ini"
NC_LOGIN_JAR_PATH="${NC_HOME}/webapps/nc_web/Client/appletjar"
NC_LOGIN_JAR_VERSION=$(cat "${NC_LOGIN_JAR_CONF}")
NC_LOGIN_JAR="${NC_LOGIN_JAR_PATH}/${NC_LOGIN_JAR_VERSION}"

LOGLEVEL=ERROR

# 检查 NC_HOME
if [ "${NC_HOME}" = "" ]; then
    echo "NC_HOME environment variable is invalid."
    exit 1
fi

# 检查 ufjdk
if [ ! -f "${NC_JAVA_HOME}/bin/java" ]; then
    echo "Current ufjdk is ${NC_JAVA_HOME}."
    echo "Warning: ufjdk is invalid."
    echo "Warning: We will check your JAVA_HOME environment variable."
else
    JAVA_VERSION=$("${NC_JAVA_HOME}/bin/java" -version 2>&1 | awk '/java version/ {print $3}' | sed 's/"//g' | awk '{if ($1>=17 && $1<18) print "ok"}')
    if [ ! "$JAVA_VERSION" = "ok" ]; then
        JAVA_VERSION=$("${NC_JAVA_HOME}/bin/java" -version 2>&1 | awk '/openjdk version/ {print $3}' | sed 's/"//g' | awk '{if ($1>=17 && $1<18) print "ok"}')
    fi

    if [ ! "${JAVA_VERSION}" = "ok" ]; then
        echo "Current ufjdk is ${NC_JAVA_HOME}."
        echo "Warning: ufjdk version must be 17."
        echo "Warning: We will check your JAVA_HOME environment variable."
    else
        JAVA_HOME="${NC_JAVA_HOME}"
    fi
fi

# 优先使用 USER_JAVA_HOME
if [ ! "${USER_JAVA_HOME}" = "" ]; then
    JAVA_HOME="${USER_JAVA_HOME}"
fi

# 检查 JAVA_HOME
if [ "${JAVA_HOME}" = "" ]; then
    echo "JAVA_HOME environment variable is undefined. Please set it."
    echo "example: export JAVA_HOME=/opt/jdk17"
    echo "         export PATH=\$JAVA_HOME/bin:\$PATH"
    exit 1
fi

if [ ! -f "${JAVA_HOME}/bin/java" ]; then
    echo "Current JAVA_HOME is ${JAVA_HOME}."
    echo "JAVA_HOME is invalid."
    exit 1
fi

# 检查 JDK 版本
JAVA_VERSION=$("${JAVA_HOME}/bin/java" -version 2>&1 | awk '/java version/ {print $3}' | sed 's/"//g' | awk '{if ($1>=17 && $1<18) print "ok"}')
if [ ! "$JAVA_VERSION" = "ok" ]; then
    JAVA_VERSION=$("${JAVA_HOME}/bin/java" -version 2>&1 | awk '/openjdk version/ {print $3}' | sed 's/"//g' | awk '{if ($1>=17 && $1<18) print "ok"}')
fi

if [ ! "${JAVA_VERSION}" = "ok" ]; then
    echo "Current JAVA_HOME is ${JAVA_HOME}."
    echo "ERROR: JDK version must be 17. Please set JAVA_HOME correctly."
    exit 1
fi

# 设置环境变量
NC_STORE_FILE="${BIN_HOME}/cert/ufida.jks"
NC_CERT_FILE="${BIN_HOME}/cert/ufida.cer"
NC_STORE_PASS=ufidauap
NC_STORE_TYPE=JKS
NC_STORE_ALIAS=ufida

PATH="${JAVA_HOME}/bin:${ANT_HOME}/bin:${PATH}"
NC_CLASSPATH=".:"${NC_HOME}/starter.jar":"${ANT_HOME}/lib/ant-launcher.jar":"${NC_HOME}/lib/cnytiruces.jar"

LAST_SERVER_SELECTION=uas
IS_USE_MASTER=true

echo "PLATFORM=${PLATFORM} ${ARCH}."
echo "JAVA_HOME=${JAVA_HOME}."
echo "NC_HOME=${NC_HOME}."