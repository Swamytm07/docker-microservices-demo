pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }
    environment {
        PATH = "C:\\Program Files\\nodejs;C:\\Program Files\\Docker\\Docker\\resources\\bin;C:\\Program Files\\Git\\cmd;${env.PATH}"
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }


        stage('Validate Tools') {
            steps {
                bat '''
                    echo Checking Node.js
                    node --version

                    echo Checking npm
                    npm --version

                    echo Checking Docker
                    docker --version

                    echo Checking Docker Compose
                    docker compose version

                    echo Checking Docker Engine access
                    docker info --format "Docker Engine: {{.ServerVersion}}"
                '''
            }
        }
        
   	
stage('Verify AWS ECR Access') {
    steps {
        withCredentials([
            usernamePassword(
                credentialsId: 'aws-ecr-credentials',
                usernameVariable: 'AWS_ACCESS_KEY_ID',
                passwordVariable: 'AWS_SECRET_ACCESS_KEY'
            )
        ]) {
            bat '''
                @echo off
                set AWS_PAGER=
                set AWS_DEFAULT_REGION=ap-southeast-2

                set AWSCLI="C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"

                echo Checking AWS identity...

                for /f %%A in ('%AWSCLI% sts get-caller-identity --query Account --output text --no-cli-pager') do set AWS_ACCOUNT=%%A

                if not "%AWS_ACCOUNT%"=="590113511490" (
                    echo ERROR: Incorrect AWS account: %AWS_ACCOUNT%
                    exit /b 1
                )

                echo AWS account verified: %AWS_ACCOUNT%

                echo Verifying ECR authentication...

                %AWSCLI% ecr get-login-password --region ap-southeast-2 | docker login --username AWS --password-stdin 590113511490.dkr.ecr.ap-southeast-2.amazonaws.com

                if errorlevel 1 exit /b 1

                echo AWS ECR authentication successful.
            '''
        }
    }
}



        stage('Build TypeScript Services') {
            steps {
                dir('api-gateway') {
                    bat 'npm ci'
                    bat 'npm run build'
                }

                dir('user-service') {
                    bat 'npm ci'
                    bat 'npm run build'
                }

                dir('product-service') {
                    bat 'npm ci'
                    bat 'npm run build'
                }

                dir('order-service') {
                    bat 'npm ci'
                    bat 'npm run build'
                }
            }
        }

              stage('Automated Tests') {
    steps {
        dir('api-gateway') {
            bat 'npm test -- --runInBand'
        }
        dir('user-service') {
            bat 'npm test -- --runInBand'
        }
        dir('product-service') {
            bat 'npm test -- --runInBand'
        }
        dir('order-service') {
            bat 'npm test -- --runInBand'
        }
    }
}
        stage('Build Docker Images') {
            steps {
                bat '''
                    docker build -t microservicesassignment-api-gateway:%BUILD_NUMBER% api-gateway
                    docker build -t microservicesassignment-user-service:%BUILD_NUMBER% user-service
                    docker build -t microservicesassignment-product-service:%BUILD_NUMBER% product-service
                    docker build -t microservicesassignment-order-service:%BUILD_NUMBER% order-service
                '''
            }
        }
    }

stage('Push Images to Amazon ECR') {
    steps {
        withCredentials([
            usernamePassword(
                credentialsId: 'aws-ecr-credentials',
                usernameVariable: 'AWS_ACCESS_KEY_ID',
                passwordVariable: 'AWS_SECRET_ACCESS_KEY'
            )
        ]) {
            bat '''
                @echo off
                set AWS_PAGER=
                set AWS_DEFAULT_REGION=ap-southeast-2
                set AWS_REGION=ap-southeast-2
                set AWS_ACCOUNT=590113511490
                set ECR_REGISTRY=%AWS_ACCOUNT%.dkr.ecr.%AWS_REGION%.amazonaws.com
                set "AWSCLI=C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"

                echo Logging in to Amazon ECR...

                "%AWSCLI%" ecr get-login-password --region %AWS_REGION% --no-cli-pager | docker login --username AWS --password-stdin %ECR_REGISTRY%

                if errorlevel 1 exit /b 1

                echo Tagging Docker images...

                docker tag microservicesassignment-api-gateway:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-api-gateway:%BUILD_NUMBER%
                docker tag microservicesassignment-user-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-user-service:%BUILD_NUMBER%
                docker tag microservicesassignment-product-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-product-service:%BUILD_NUMBER%
                docker tag microservicesassignment-order-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-order-service:%BUILD_NUMBER%

                docker tag microservicesassignment-api-gateway:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-api-gateway:latest
                docker tag microservicesassignment-user-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-user-service:latest
                docker tag microservicesassignment-product-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-product-service:latest
                docker tag microservicesassignment-order-service:%BUILD_NUMBER% %ECR_REGISTRY%/microservicesassignment-order-service:latest

                if errorlevel 1 exit /b 1

                echo Pushing API Gateway...
                docker push %ECR_REGISTRY%/microservicesassignment-api-gateway:%BUILD_NUMBER%
                if errorlevel 1 exit /b 1
                docker push %ECR_REGISTRY%/microservicesassignment-api-gateway:latest
                if errorlevel 1 exit /b 1

                echo Pushing User Service...
                docker push %ECR_REGISTRY%/microservicesassignment-user-service:%BUILD_NUMBER%
                if errorlevel 1 exit /b 1
                docker push %ECR_REGISTRY%/microservicesassignment-user-service:latest
                if errorlevel 1 exit /b 1

                echo Pushing Product Service...
                docker push %ECR_REGISTRY%/microservicesassignment-product-service:%BUILD_NUMBER%
                if errorlevel 1 exit /b 1
                docker push %ECR_REGISTRY%/microservicesassignment-product-service:latest
                if errorlevel 1 exit /b 1

                echo Pushing Order Service...
                docker push %ECR_REGISTRY%/microservicesassignment-order-service:%BUILD_NUMBER%
                if errorlevel 1 exit /b 1
                docker push %ECR_REGISTRY%/microservicesassignment-order-service:latest
                if errorlevel 1 exit /b 1

                echo All four services successfully pushed to Amazon ECR.
            '''
        }
    }
}


    post {
        success {
            echo 'Microservices CI pipeline completed successfully.'
        }

        failure {
            echo 'Pipeline failed. Check the Jenkins console output.'
        }
    }
}
