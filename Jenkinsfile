pipeline {
    agent any

    // Define build parameters for flexible branch selection (default: main)
    parameters {
        string(name: 'BRANCH_NAME', defaultValue: 'main', description: 'Git branch to build and deploy')
    }

    // Automatically trigger build when a push event is received from GitHub webhook
    triggers {
        githubPush()
    }

    environment {
        NODE_ENV = 'production'
        PATH = "/usr/local/bin:${env.PATH}"
        APP_DIR = '/opt/pgvitals'
        GITHUB_CREDENTIALS_ID = 'github-credentials' // ID of stored credential in Jenkins Credentials Manager
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        disableConcurrentBuilds()
        ansiColor('xterm')
    }

    stages {
        stage('Checkout GitHub Repository') {
            steps {
                echo "Checking out branch '${params.BRANCH_NAME}' from GitHub..."
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: "refs/heads/${params.BRANCH_NAME}"]],
                    userRemoteConfigs: [[
                        url: 'https://github.com/aungba/pgvitals.git',
                        credentialsId: "${env.GITHUB_CREDENTIALS_ID}"
                    ]]
                ])
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing pnpm and dependencies...'
                sh '''
                    corepack enable || true
                    corepack prepare pnpm@latest --activate || true
                    pnpm install --frozen-lockfile
                '''
            }
        }

        stage('Run Tests') {
            steps {
                echo 'Running automated test suite...'
                sh 'pnpm test'
            }
        }

        stage('Build Applications') {
            steps {
                echo 'Building Collector and Web applications...'
                sh '''
                    pnpm --filter @pgvitals/collector build
                    pnpm --filter @pgvitals/web build
                '''
            }
        }

        stage('Database Migrations') {
            steps {
                echo 'Applying database migrations...'
                sh 'pnpm db:migrate'
            }
        }

        stage('Sync to Deploy Directory') {
            steps {
                echo "Syncing build artifacts to ${env.APP_DIR}..."
                sh """
                    rsync -a --delete \
                      --exclude '.git' \
                      --exclude 'node_modules' \
                      --exclude '.env' \
                      ./ ${env.APP_DIR}/

                    cd ${env.APP_DIR}
                    pnpm install --frozen-lockfile --prod
                """
            }
        }

        stage('Deploy Services (PM2)') {
            steps {
                echo 'Deploying and restarting PM2 process manager services...'
                sh """
                    cd ${env.APP_DIR}
                    pm2 restart pgvitals-collector || pm2 start ecosystem.config.cjs --only pgvitals-collector
                    pm2 restart pgvitals-web || pm2 start ecosystem.config.cjs --only pgvitals-web
                    pm2 save
                """
            }
        }

        stage('Verify Health') {
            steps {
                echo 'Verifying application health...'
                sh '''
                    echo "Checking Collector API health..."
                    curl -sf http://localhost:3001/health || (echo "Collector health check failed!" && exit 1)

                    echo "Checking Web Dashboard response..."
                    curl -sf -o /dev/null http://localhost:3000 || (echo "Web app health check failed!" && exit 1)
                '''
            }
        }
    }

    post {
        success {
            echo "✓ PG Vitals bare-metal deployment of branch '${params.BRANCH_NAME}' succeeded."
        }
        failure {
            echo "✗ PG Vitals deployment failed for branch '${params.BRANCH_NAME}'."
        }
        always {
            sh 'pm2 status'
        }
    }
}
