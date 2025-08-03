#!/bin/bash

# TWAP Deployment Script
# This script provides easy deployment commands for the TWAP contract across different networks
source .env
echo "PRIVATE_KEY: $PRIVATE_KEY"
echo "RPC_URL: $RPC_URL"
echo "NETWORK: $NETWORK"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if required environment variables are set
check_env() {
    if [ -z "$PRIVATE_KEY" ]; then
        print_error "PRIVATE_KEY environment variable is not set"
        exit 1
    fi
    
    if [ -z "$RPC_URL" ]; then
        print_error "RPC_URL environment variable is not set"
        exit 1
    fi
}

# Function to deploy to a specific network
deploy_to_network() {
    print_status "Deploying TWAP contract..."
    
    # Run the deployment
    forge script script/DeployTwap.sol \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY" \
        --broadcast \
        --verify \
        --via-ir
    
    print_success "TWAP contract deployed"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [NETWORK]"
    echo ""
    echo "Supported networks:"
    echo "  mainnet     - Ethereum Mainnet"
    echo "  arbitrum    - Arbitrum One"
    echo "  base        - Base"
    echo "  optimism    - Optimism"
    echo "  polygon     - Polygon"
    echo "  bsc         - Binance Smart Chain"
   
    echo ""
    echo "Environment variables:"
    echo "  PRIVATE_KEY - Your private key for deployment"
    echo "  RPC_URL     - RPC URL for the target network"
    echo "  NETWORK     - Network name (optional, can be passed as argument)"
    echo "  CUSTOM_LOP_ADDRESS - Custom LOP address (optional)"
    echo ""
    echo "Examples:"
    echo "  $0 mainnet"
    echo "  $0 arbitrum"
    echo "  NETWORK=base $0"
}

# Main script logic
main() {
    # Check if help is requested
    if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        show_usage
        exit 0
    fi
    
    # Check environment variables
    check_env
    
    # Determine network
    local network=${NETWORK:-$1}
    
    if [ -z "$network" ]; then
        print_error "No network specified. Use -h for help."
        exit 1
    fi
    
    # Map network names to display names
    case $network in
        "mainnet")
            deploy_to_network "mainnet" "Ethereum Mainnet"
            ;;
        "arbitrum")
            deploy_to_network "arbitrum" "Arbitrum One"
            ;;
        "base")
            deploy_to_network "base" "Base"
            ;;
        "optimism")
            deploy_to_network "optimism" "Optimism"
            ;;
        "polygon")
            deploy_to_network "polygon" "Polygon"
            ;;
        "bsc")
            deploy_to_network "bsc" "Binance Smart Chain"
            ;;
        "localhost")
            deploy_to_network "localhost" "Localhost"
            ;;
        *)
            print_error "Unsupported network: $network"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@" 