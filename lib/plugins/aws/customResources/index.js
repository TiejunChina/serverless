'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');
const BbPromise = require('bluebird');
const globby = require('globby');

// TODO: move function in util
function createZipFile(srcDirPath, outputFilePath) {
  const files = globby
    .sync(['**'], {
      cwd: srcDirPath,
      dot: true,
      silent: true,
    })
    .map(file => ({
      input: path.join(srcDirPath, file),
      output: file,
    }));

  return new BbPromise((resolve, reject) => {
    const output = fs.createWriteStream(outputFilePath);
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    output.on('open', () => {
      archive.pipe(output);

      files.forEach(file => {
        // TODO: update since this is REALLY slow
        if (fs.lstatSync(file.input).isFile()) {
          archive.append(fs.createReadStream(file.input), { name: file.output });
        }
      });

      archive.finalize();
    });

    archive.on('error', err => reject(err));
    output.on('close', () => resolve(outputFilePath));
  });
}

function addCustomResourceToService(resourceName) {
  let FunctionName;
  let Handler;
  let srcDirPath;
  let customResourceFunctionLogicalId;
  const destDirPath = path.join(
    this.serverless.config.servicePath,
    '.serverless',
    this.provider.naming.getCustomResourcesArtifactDirectoryName()
  );
  const zipFilePath = `${destDirPath}.zip`;
  this.serverless.utils.writeFileDir(zipFilePath);

  if (resourceName === 's3') {
    FunctionName = `${this.serverless.service.service}-${
      this.options.stage
    }-${this.provider.naming.getCustomResourceS3HandlerFunctionName()}`;
    Handler = this.provider.naming.getCustomResourceS3HandlerPath();
    customResourceFunctionLogicalId = this.provider.naming.getCustomResourceS3HandlerFunctionLogicalId();
    srcDirPath = path.join(__dirname, 's3');
  }

  // copy the custom resource source files
  this.serverless.utils.copyDirContentsSync(srcDirPath, destDirPath);

  // install the npm dependencies
  execSync('npm install', { cwd: destDirPath });

  return createZipFile(srcDirPath, zipFilePath).then(outputFilePath => {
    let S3Bucket = {
      Ref: this.provider.naming.getDeploymentBucketLogicalId(),
    };
    if (this.serverless.service.package.deploymentBucket) {
      S3Bucket = this.serverless.service.package.deploymentBucket;
    }
    const s3Folder = this.serverless.service.package.artifactDirectoryName;
    const s3FileName = outputFilePath.split(path.sep).pop();
    const S3Key = `${s3Folder}/${s3FileName}`;

    const customResourceFunction = {
      [customResourceFunctionLogicalId]: {
        Type: 'AWS::Lambda::Function',
        Properties: {
          Code: {
            S3Bucket,
            S3Key,
          },
          FunctionName,
          Handler,
          MemorySize: 1024,
          Role: {
            'Fn::GetAtt': [this.provider.naming.getRoleLogicalId(), 'Arn'],
          },
          Runtime: 'nodejs10.x',
          Timeout: 6,
        },
        DependsOn: [this.provider.naming.getRoleLogicalId()],
      },
    };

    Object.assign(
      this.serverless.service.provider.compiledCloudFormationTemplate.Resources,
      customResourceFunction
    );
  });
}

module.exports = {
  addCustomResourceToService,
};
