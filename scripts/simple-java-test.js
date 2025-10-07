const { execSync } = require('child_process');

try {
  // 获取Java版本信息
  const javaVersionOutput = execSync('java -version 2>&1', { encoding: 'utf-8' });
  console.log('Java版本信息:');
  console.log(javaVersionOutput);
  
  // 检查版本
  if (javaVersionOutput.includes('version "1.8')) {
    console.log('检测到Java 8');
  } else if (javaVersionOutput.includes('version "11')) {
    console.log('检测到Java 11');
  } else if (javaVersionOutput.includes('version "17')) {
    console.log('检测到Java 17');
  } else {
    console.log('检测到其他Java版本');
  }
} catch (error) {
  console.log('获取Java版本时出错:', error.message);
}