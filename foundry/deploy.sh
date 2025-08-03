#!/bin/bash

# TWAP Deployment Script
# This script provides easy deployment commands for the TWAP contract across different networks

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
    local network=$1
    local network_name=$2
    
    print_status "Deploying TWAP contract to $network_name..."
    
    # Set network environment variable
    export NETWORK=$network
    
    # Run the deployment
    forge script script/DeployTwap.sol \
        --rpc-url "$RPC_URL" \
        --private-key "$PRIVATE_KEY" \
        --broadcast \
        --verify
    
    print_success "TWAP contract deployed to $network_name"
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
    echo "  avalanche   - Avalanche"
    echo "  fantom      - Fantom"
    echo "  linea       - Linea"
    echo "  scroll      - Scroll"
    echo "  mantle      - Mantle"
    echo "  zksync      - zkSync Era"
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
        "avalanche")
            deploy_to_network "avalanche" "Avalanche"
            ;;
        "fantom")
            deploy_to_network "fantom" "Fantom"
            ;;
        "linea")
            deploy_to_network "linea" "Linea"
            ;;
        "scroll")
            deploy_to_network "scroll" "Scroll"
            ;;
        "mantle")
            deploy_to_network "mantle" "Mantle"
            ;;
        "zksync")
            deploy_to_network "zksync" "zkSync Era"
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