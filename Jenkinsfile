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

    post {
        success {
            echo 'Microservices CI pipeline completed successfully.'
        }

        failure {
            echo 'Pipeline failed. Check the Jenkins console output.'
        }
    }
}
