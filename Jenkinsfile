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
        // Clerk auth credentials ID (stores publishable key)
        CLERK_CREDENTIALS_ID = 'clerk-publishable-key'
        // Production server hostname
        DEPLOY_HOST = 'pgva.eastasia.cloudapp.azure.com'
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
                // Wipe workspace and configure git safe.directory to prevent ownership mismatch errors
                sh '''
                    docker run --rm -v "$WORKSPACE:/ws" alpine sh -c "chmod -R 777 /ws 2>/dev/null || true; rm -rf /ws/* /ws/.[!.]* /ws/..?* 2>/dev/null || true"
                    git config --global --add safe.directory "$WORKSPACE" || true
                    git config --global --add safe.directory '*' || true
                '''

                echo "Checking out branch '${params.BRANCH_NAME}' from GitHub..."
                checkout([
                    $class: 'GitSCM',
                    branches: [[name: "refs/heads/${params.BRANCH_NAME}"]],
                    extensions: [
                        [$class: 'CleanBeforeCheckout']
                    ],
                    userRemoteConfigs: [[
                        url: 'https://github.com/aungba/pgvitals.git',
                        credentialsId: "${env.GITHUB_CREDENTIALS_ID}"
                    ]]
                ])
                stash includes: '**', excludes: '**/node_modules/**,**/.git/**,**/.pnpm-store/**', name: 'source'
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

                echo 'Building DB package...'
                sh '''
                    export PNPM_STORE_DIR=/tmp/.pnpm-store
                    pnpm --filter @pgvitals/db build
                '''

                echo 'Running automated test suite...'
                sh '''
                    export PNPM_STORE_DIR=/tmp/.pnpm-store
                    pnpm test
                '''

                echo 'Building Collector and Web applications...'
                withCredentials([string(credentialsId: env.CLERK_CREDENTIALS_ID, variable: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')]) {
                    sh '''
                        export PNPM_STORE_DIR=/tmp/.pnpm-store
                        pnpm --filter @pgvitals/collector build
                        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY pnpm --filter @pgvitals/web build
                    '''
                }

                // Fix file ownership & permissions: restore owner to Jenkins host user so unstash / setTimes succeeds
                sh '''
                    OWNER=$(stat -c '%u:%g' package.json 2>/dev/null || stat -c '%u:%g' . 2>/dev/null || echo "109:112")
                    chown -R "$OWNER" . || true
                    chmod -R 777 . || true
                '''

                stash includes: '**,apps/web/.next/**', excludes: '**/node_modules/**,**/.git/**,**/.pnpm-store/**', name: 'build'
            }
        }

        stage('Deploy to Production') {
            agent any
            steps {
                unstash 'build'

                echo "Deploying to ${env.DEPLOY_HOST}..."
                withCredentials([sshUserPrivateKey(credentialsId: env.DEPLOY_SSH_CREDENTIALS_ID, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    // 1. Sync build artifacts to production server (preserving .env files)
                    sh """
                        rsync -az --delete \
                          --exclude '.git' \
                          --exclude 'node_modules' \
                          --exclude '.env' \
                          --exclude 'apps/*/.env' \
                          -e 'ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no' \
                          ./ ${env.DEPLOY_USER}@${env.DEPLOY_HOST}:${env.APP_DIR}/
                    """

                    // 2. Install dependencies on the remote server (includes tsx for migrations)
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            export CI=true
                            corepack enable || true
                            pnpm install --frozen-lockfile || pnpm install --frozen-lockfile --ignore-scripts
                            # Ensure sub-apps have .env if root .env exists
                            [ -f .env ] && [ ! -f apps/collector/.env ] && cp .env apps/collector/.env || true
                            [ -f .env ] && [ ! -f apps/web/.env ] && cp .env apps/web/.env || true
                        '
                    """

                    // 3. Run database migrations on the remote server (non-blocking if already applied)
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            pnpm db:migrate || echo "⚠️  Migration had errors (tables may already exist) — continuing..."
                        '
                    """

                    // 4. Restart PM2 services on the remote server
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            cd ${env.APP_DIR}
                            export PATH="/usr/local/bin:\$PATH"
                            mkdir -p /var/log/pgvitals
                            pm2 delete all 2>/dev/null || true
                            pm2 start ecosystem.config.cjs
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
                sleep 5
                withCredentials([sshUserPrivateKey(credentialsId: env.DEPLOY_SSH_CREDENTIALS_ID, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]) {
                    sh """
                        ssh -i ${SSH_KEY} -o StrictHostKeyChecking=no ${env.DEPLOY_USER}@${env.DEPLOY_HOST} '
                            echo "Checking Collector API health..."
                            COLLECTOR_OK=0
                            for i in \$(seq 1 15); do
                                if curl -sf http://localhost:3001/health; then
                                    echo "\\nCollector API is healthy."
                                    COLLECTOR_OK=1
                                    break
                                fi
                                echo "Waiting for Collector API... (\$i/15)"
                                sleep 2
                            done
                            if [ "\$COLLECTOR_OK" != "1" ]; then
                                echo "Collector health check failed!"
                                pm2 status
                                cat /var/log/pgvitals/collector-error.log 2>/dev/null | tail -n 30 || true
                                exit 1
                            fi

                            echo "Checking Web Dashboard response..."
                            WEB_OK=0
                            for i in \$(seq 1 15); do
                                STATUS=\$(curl -s -o /dev/null -w "%{http_code}" -L http://localhost:3000 || echo "000")
                                if [ "\$STATUS" = "200" ] || [ "\$STATUS" = "307" ] || [ "\$STATUS" = "308" ] || [ "\$STATUS" = "302" ]; then
                                    echo "Web Dashboard is healthy (HTTP \$STATUS)."
                                    WEB_OK=1
                                    break
                                fi
                                echo "Waiting for Web Dashboard... (HTTP \$STATUS, attempt \$i/15)"
                                sleep 2
                            done
                            if [ "\$WEB_OK" != "1" ]; then
                                echo "Web app health check failed! Final status: \$STATUS"
                                echo "=== PM2 Status ==="
                                pm2 status
                                echo "=== Web Error Log (/var/log/pgvitals/web-error.log) ==="
                                cat /var/log/pgvitals/web-error.log 2>/dev/null | tail -n 40 || true
                                echo "=== Web Output Log (/var/log/pgvitals/web-out.log) ==="
                                cat /var/log/pgvitals/web-out.log 2>/dev/null | tail -n 40 || true
                                exit 1
                            fi
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
