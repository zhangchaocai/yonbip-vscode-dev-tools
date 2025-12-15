#!/bin/sh 
# 
###############################################
# Purpose: NC application tool for NC console
# Author:  UFIDA��zhangwei@ufida.com.cn        
#                                              
###############################################

export JAVA_HOME=替换为用户的jdk路径

cd `dirname $0`
BIN_HOME=`pwd`

if [ -f ${BIN_HOME}/../.newInstall ] ; then 
	rm -f ${BIN_HOME}/../.newInstall
fi
if [ -f ${BIN_HOME}/../.needDeployEjb ] ; then  
	rm -f ${BIN_HOME}/../.needDeployEjb
fi

if [ ! "${1}" = "" ] ; then
  USER_JAVA_HOME=${1}
  . ${BIN_HOME}/uapSetupCmdLine.sh ${USER_JAVA_HOME}
  . ${BIN_HOME}/wasSetupCmdLine.sh
  . ${BIN_HOME}/wlsSetupCmdLine.sh
else
  . ${BIN_HOME}/uapSetupCmdLine.sh
  . ${BIN_HOME}/wasSetupCmdLine.sh
  . ${BIN_HOME}/wlsSetupCmdLine.sh
fi


${ANT_HOME}/bin/ant -buildfile ${BIN_HOME}/buildmisc.xml sysConfig -Dapp.server=uas -DJAVA_HOME=${JAVA_HOME} -Dapp.server="${LAST_SERVER_SELECTION}" -Dusemaster="${IS_USE_MASTER}"
