pipeline {
    agent none

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
        APP_DIR = '/opt/pgvitals'

        // Jenkins Credentials Manager IDs
        GITHUB_CREDENTIALS_ID = 'github-credentials'
        // SSH credentials for the production Azure VM
        DEPLOY_SSH_CREDENTIALS_ID = 'pgvitals-production-ssh'
        // Production server hostname
        DEPLOY_HOST = 'pgva.japaneast.cloudapp.azure.com'
        DEPLOY_USER = 'pgvitals'
    }

    options {
        timeout(time: 15, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    stages {
        stage('Checkout GitHub Repository') {
            agent any
            steps {
                // Clean ALL root-owned files from previous Docker builds (jenkins user can't overwrite them)
                sh 'docker run --rm -v "$WORKSPACE:/ws" alpine sh -c "find /ws -user root -exec rm -rf {} + 2>/dev/null; true"'

                echo "Checking out branch '${params.BRANCH_NAME}' from GitHub..."
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: "refs/heads/${params.BRANCH_NAME}"]],
                    userRemoteConfigs: [[
                        url: 'https://github.com/aungba/pgvitals.git',
                        credentialsId: "${env.GITHUB_CREDENTIALS_ID}"
                    ]]
                ])
                stash includes: '**', excludes: '.pnpm-store/**,node_modules/**', name: 'source'
            }
        }

        stage('Build & Test') {
            agent {
                docker {
                    image 'node:22-slim'
                    args '-u root -e PNPM_STORE_DIR=/tmp/.pnpm-store'
                }
            }
            steps {
                unstash 'source'

                echo 'Installing pnpm and dependencies...'
                sh '''
                    export PNPM_STORE_DIR=/tmp/.pnpm-store
                    corepack enable
                    corepack prepare pnpm@latest --activate
                    pnpm install --frozen-lockfile || pnpm install --frozen-lockfile --ignore-scripts
                '''

                echo 'Running automated test suite...'
                sh '''
                    export PNPM_STORE_DIR=/tmp/.pnpm-store
                    pnpm test
                '''

                echo 'Building Collector and Web applications...'
                sh '''
                    export PNPM_STORE_DIR=/tmp/.pnpm-store
                    pnpm --filter @pgvitals/collector build
                    pnpm --filter @pgvitals/web build
                '''

                stash includes: '**', excludes: 'node_modules/**,.git/**,.pnpm-store/**', name: 'build'
            }
        }

        stage('Deploy to Production') {
            agent any
            steps {
                unstash 'build'

                echo "Deploying to ${env.DEPLOY_HOST}..."
                sshagent(credentials: [env.DEPLOY_SSH_CREDENTIALS_ID]) {
                    // 1. Sync build artifacts to production server (preserving .env files)
                    sh """
                        rsync -az --delete \
                          --exclude '.git' \
                          --exclude 'node_modules' \
                          --exclude '.env' \
                          -e 'ssh -o StrictHostKeyChecking=no' \
                          ./ ${env.DEPLOY_USER}@${env.DEPLOY_HOST}:${env.APP_DIR}/
                    """

                    // 2. Install production dependencies on the remote server
                    sh """
                        ssh -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            corepack enable || true
                            pnpm install --frozen-lockfile --prod
                        '
                    """

                    // 3. Run database migrations on the remote server
                    sh """
                        ssh -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            pnpm db:migrate
                        '
                    """

                    // 4. Restart PM2 services on the remote server
                    sh """
                        ssh -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            pm2 restart pgvitals-collector || pm2 start ecosystem.config.cjs --only pgvitals-collector
                            pm2 restart pgvitals-web || pm2 start ecosystem.config.cjs --only pgvitals-web
                            pm2 save
                        '
                    """
                }
            }
        }

        stage('Verify Health') {
            agent any
            steps {
                echo 'Verifying application health...'
                sshagent(credentials: [env.DEPLOY_SSH_CREDENTIALS_ID]) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            echo "Checking Collector API health..."
                            curl -sf http://localhost:3001/health || (echo "Collector health check failed!" && exit 1)

                            echo "Checking Web Dashboard response..."
                            curl -sf -o /dev/null http://localhost:3000 || (echo "Web app health check failed!" && exit 1)
                        '
                    """
                }
            }
        }
    }

    post {
        success {
            echo "✓ PG Vitals deployment of branch '${params.BRANCH_NAME}' to ${env.DEPLOY_HOST} succeeded."
        }
        failure {
            echo "✗ PG Vitals deployment failed for branch '${params.BRANCH_NAME}'."
        }
    }
}
