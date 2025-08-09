class CandleChart {
    constructor() {
        this.chart = null;
        this.rsiChart = null;
        this.macdChart = null;
        this.data = [];
        this.timeframe = '1m';
        this.pair = 'BTCUSDT';
        this.refreshInterval = null;
        this.trades = [];
        this.stopLossPercent = 0.5; // 2% stop loss
        this.takeProfitPercent = 1.25; // 5% take profit
        this.currentPosition = null;
        this.previousPair = this.pair;

        this.tradeSettings = {
            stopLossPercent: 0.5, // 2% stop loss
            takeProfitPercent: 1.25, // 5% take profit
            positionSizePercent: 10, // Risk 10% of virtual balance per trade
            virtualBalance: 100000, // Starting virtual balance
            commission: 0.001, // 0.1% trading commission
            slippage: 0.005, // 0.5% price slippage
            dollerPrice: 93.0
        };

        this.performanceMetrics = {
            totalTrades: 0,
            winningTrades: 0,
            losingTrades: 0,
            winRate: 0,
            totalPnl: 0,
            maxDrawdown: 0,
            profitFactor: 0,
            averageTradeDuration: 0
        };

        this.indicators = {
            supertrend: {
                enabled: true,
                period: 10,
                multiplier: 3
            },
            rsi: {
                enabled: true,
                period: 14,
                overbought: 70,
                oversold: 30
            },
            macd: {
                enabled: true,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9
            },
            supportResistance: {
                enabled: true,
                period: 20
            }
        };

        this.binanceTimeframes = {
            '1m': '1m',
            '5m': '5m',
            '15m': '15m',
            '1h': '1h',
            '4h': '4h',
            '1d': '1d'
        };

        this.initChart();
        this.initEventListeners();
        this.loadData();
        this.startAutoRefresh();
        this.loadTradeData();

    }
    saveTradeData() {
        const tradeData = {
            trades: this.trades,
            currentPosition: this.currentPosition,
            virtualBalance: this.tradeSettings.virtualBalance,
            performanceMetrics: this.performanceMetrics,
            pair: this.pair
        };
        localStorage.setItem(`tradeData_${this.pair}`, JSON.stringify(tradeData));
    }

    loadTradeData() {
        try {
            const savedData = localStorage.getItem(`tradeData_${this.pair}`);
            if (savedData) {
                const tradeData = JSON.parse(savedData);

                // Validate the loaded data structure
                if (!tradeData || typeof tradeData !== 'object') {
                    throw new Error('Invalid trade data format');
                }

                this.trades = Array.isArray(tradeData.trades) ? tradeData.trades : [];
                this.currentPosition = tradeData.currentPosition || null;

                // Validate and set virtual balance
                const virtualBalance = parseFloat(tradeData.virtualBalance);
                this.tradeSettings.virtualBalance = isNaN(virtualBalance) ? 100000 : virtualBalance;

                // Validate performance metrics
                this.performanceMetrics = {
                    totalTrades: parseInt(tradeData.performanceMetrics?.totalTrades) || 0,
                    winningTrades: parseInt(tradeData.performanceMetrics?.winningTrades) || 0,
                    losingTrades: parseInt(tradeData.performanceMetrics?.losingTrades) || 0,
                    winRate: parseFloat(tradeData.performanceMetrics?.winRate) || 0,
                    totalPnl: parseFloat(tradeData.performanceMetrics?.totalPnl) || 0,
                    maxDrawdown: parseFloat(tradeData.performanceMetrics?.maxDrawdown) || 0,
                    profitFactor: parseFloat(tradeData.performanceMetrics?.profitFactor) || 0,
                    averageTradeDuration: parseFloat(tradeData.performanceMetrics?.averageTradeDuration) || 0
                };

                // Recreate trade visuals when data is loaded
                this.recreateTradeVisuals();
                this.updatePerformanceMetrics();

                //console.log('Successfully loaded trade data for', this.pair);
            }
        } catch (error) {
            console.error('Error loading trade data:', error);
            // Reset to defaults if loading fails
            this.trades = [];
            this.currentPosition = null;
            this.tradeSettings.virtualBalance = 100000;
            this.performanceMetrics = {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnl: 0,
                maxDrawdown: 0,
                profitFactor: 0,
                averageTradeDuration: 0
            };
        }
    }
    // Add this new method
    simulateTrades(data) {
        this.tradeMarkers = [];
        this.tradeLines = [];

        // Sort data by time if not already sorted
        data.sort((a, b) => new Date(a.time) - new Date(b.time));

        for (let i = 0; i < data.length; i++) {
            const candle = data[i];

            if (!candle.signal || !candle.signal.type)
                continue;

            // Skip if candle time is too old (missed) from current time
            const currentTime = new Date();
            const candleTime = new Date(candle.time);
            const maxTimeDiff = 1 * 60 * 1000; // 1 minute in milliseconds
            if (currentTime - candleTime > maxTimeDiff)
                continue;

            // Calculate entry price with slippage
            const isBuySignal = candle.signal.type.includes('buy');
            const entryPrice = this.applySlippage(
                    isBuySignal ? candle.high : candle.low,
                    isBuySignal);

            // Validate execution price
            if (!this.validateExecutionPrice(candle.signal.price, entryPrice, isBuySignal)) {
                console.warn('Invalid execution price detected:', {
                    time: new Date(candle.time).toLocaleString(),
                    signalType: candle.signal.type,
                    signalPrice: candle.signal.price,
                    executionPrice: entryPrice,
                    isBuy: isBuySignal
                });
                continue;
            }

            // Handle buy signals
            if (isBuySignal) {
                if (this.currentPosition) {
                    if (this.currentPosition.type === 'sell') {
                        // Close existing sell position and open new buy position
                        const exitPrice = this.applySlippage(candle.high, true);
                        this.closePosition(candle, i, exitPrice, 'signal');

                        // Open new buy position after closing sell
                        const positionSize = this.calculatePositionSize(entryPrice);
                        this.currentPosition = {
                            type: 'buy',
                            entryPrice: entryPrice,
                            entryTime: candle.time,
                            entryCandleIndex: i,
                            positionSize: positionSize,
                            stopLoss: entryPrice * (1 - this.tradeSettings.stopLossPercent),
                            takeProfit: entryPrice * (1 + this.tradeSettings.takeProfitPercent),
                            commissionPaid: positionSize * entryPrice * this.tradeSettings.commission
                        };
                        this.showTradeNotification(this.currentPosition, true);
                        this.tradeSettings.virtualBalance -= this.currentPosition.commissionPaid;
                        this.addTradeMarker(candle.time, entryPrice, 'buy', `BUY @ ${entryPrice.toFixed(2)}`);
                    } else if (this.currentPosition.type === 'buy') {
                        // Increase existing buy position if another buy signal appears
                        const additionalSize = this.calculatePositionSize(entryPrice);
                        const additionalCost = additionalSize * entryPrice;
                        const additionalCommission = additionalCost * this.tradeSettings.commission;

                        this.currentPosition.positionSize += additionalSize;
                        this.currentPosition.commissionPaid += additionalCommission;
                        this.tradeSettings.virtualBalance -= additionalCommission;

                        // Update stop loss and take profit (optional)
                        this.currentPosition.stopLoss = entryPrice * (1 - this.tradeSettings.stopLossPercent);
                        this.currentPosition.takeProfit = entryPrice * (1 + this.tradeSettings.takeProfitPercent);

                        this.showTradeNotification({
                            type: 'buy',
                            entryPrice: entryPrice,
                            positionSize: additionalSize,
                            action: 'added'
                        }, true);
                        this.addTradeMarker(candle.time, entryPrice, 'buy-add', `ADD BUY @ ${entryPrice.toFixed(2)}`);
                    }
                } else {
                    // Open new buy position if no position exists
                    const positionSize = this.calculatePositionSize(entryPrice);
                    this.currentPosition = {
                        type: 'buy',
                        entryPrice: entryPrice,
                        entryTime: candle.time,
                        entryCandleIndex: i,
                        positionSize: positionSize,
                        stopLoss: entryPrice * (1 - this.tradeSettings.stopLossPercent),
                        takeProfit: entryPrice * (1 + this.tradeSettings.takeProfitPercent),
                        commissionPaid: positionSize * entryPrice * this.tradeSettings.commission
                    };
                    this.showTradeNotification(this.currentPosition, true);
                    this.tradeSettings.virtualBalance -= this.currentPosition.commissionPaid;
                    this.addTradeMarker(candle.time, entryPrice, 'buy', `BUY @ ${entryPrice.toFixed(2)}`);
                }
            }
            // Handle sell signals
            else if (candle.signal.type.includes('sell')) {
                if (this.currentPosition) {
                    if (this.currentPosition.type === 'buy') {
                        // Close existing buy position and open new sell position
                        const exitPrice = this.applySlippage(candle.low, false);
                        this.closePosition(candle, i, exitPrice, 'signal');

                        // Open new sell position after closing buy
                        const positionSize = this.calculatePositionSize(entryPrice);
                        this.currentPosition = {
                            type: 'sell',
                            entryPrice: entryPrice,
                            entryTime: candle.time,
                            entryCandleIndex: i,
                            positionSize: positionSize,
                            stopLoss: entryPrice * (1 + this.tradeSettings.stopLossPercent),
                            takeProfit: entryPrice * (1 - this.tradeSettings.takeProfitPercent),
                            commissionPaid: positionSize * entryPrice * this.tradeSettings.commission
                        };
                        this.showTradeNotification(this.currentPosition, true);
                        this.tradeSettings.virtualBalance -= this.currentPosition.commissionPaid;
                        this.addTradeMarker(candle.time, entryPrice, 'sell', 'SELL');
                    } else if (this.currentPosition.type === 'sell') {
                        // Increase existing sell position if another sell signal appears
                        const additionalSize = this.calculatePositionSize(entryPrice);
                        const additionalCost = additionalSize * entryPrice;
                        const additionalCommission = additionalCost * this.tradeSettings.commission;

                        this.currentPosition.positionSize += additionalSize;
                        this.currentPosition.commissionPaid += additionalCommission;
                        this.tradeSettings.virtualBalance -= additionalCommission;

                        // Update stop loss and take profit (optional)
                        this.currentPosition.stopLoss = entryPrice * (1 + this.tradeSettings.stopLossPercent);
                        this.currentPosition.takeProfit = entryPrice * (1 - this.tradeSettings.takeProfitPercent);

                        this.showTradeNotification({
                            type: 'sell',
                            entryPrice: entryPrice,
                            positionSize: additionalSize,
                            action: 'added'
                        }, true);
                        this.addTradeMarker(candle.time, entryPrice, 'sell-add', `ADD SELL @ ${entryPrice.toFixed(2)}`);
                    }
                } else {
                    // Open new sell position if no position exists
                    const positionSize = this.calculatePositionSize(entryPrice);
                    this.currentPosition = {
                        type: 'sell',
                        entryPrice: entryPrice,
                        entryTime: candle.time,
                        entryCandleIndex: i,
                        positionSize: positionSize,
                        stopLoss: entryPrice * (1 + this.tradeSettings.stopLossPercent),
                        takeProfit: entryPrice * (1 - this.tradeSettings.takeProfitPercent),
                        commissionPaid: positionSize * entryPrice * this.tradeSettings.commission
                    };
                    this.showTradeNotification(this.currentPosition, true);
                    this.tradeSettings.virtualBalance -= this.currentPosition.commissionPaid;
                    this.addTradeMarker(candle.time, entryPrice, 'sell', 'SELL');
                }
            }

            // Check for stop loss or take profit on current position
            this.checkPositionExitConditions(candle, i);
        }

        this.updateTradeList();
        this.updateChart();
        this.updatePerformanceMetrics();
        this.saveTradeData();
    }
    // Add this method to your class
    validateExecutionPrice(signalPrice, executionPrice, isBuy) {
        const priceDiff = executionPrice - signalPrice;
        const maxAllowedDiff = signalPrice * 0.005; // Allow 0.5% deviation

        if (isBuy) {
            // For buy orders, execution should be >= signal price (within reasonable slippage)
            return priceDiff >= 0 && priceDiff <= maxAllowedDiff;
        } else {
            // For sell orders, execution should be <= signal price (within reasonable slippage)
            return priceDiff <= 0 && Math.abs(priceDiff) <= maxAllowedDiff;
        }
    }
    // Helper methods for trade simulation
    applySlippage(price, isBuy) {
        // For buy orders: price = high + slippage (worse execution)
        // For sell orders: price = low - slippage (worse execution)
        const basePrice = isBuy ? price * 1.0005 : price * 0.499; // 0.05% initial adjustment
        //console.log("price: "+price);
        // Apply random slippage within configured range
        const slippageFactor = 1 + (Math.random() * this.tradeSettings.slippage * (isBuy ? 1 : -1));
        //console.log("slippageFactor: "+slippageFactor);
        return basePrice;
    }

    calculatePositionSize(entryPrice) {
        const riskAmount = this.tradeSettings.virtualBalance * (this.tradeSettings.positionSizePercent / 100);
        const positionSize = riskAmount / entryPrice;
        return parseFloat(positionSize.toFixed(8)); // Round to 8 decimal places for crypto
    }

    async closePosition(candle, candleIndex, exitPrice, exitReason) {
        if (!this.currentPosition)
            return;

        // Validate exit price makes sense for position type
        const isBuyPosition = this.currentPosition.type === 'buy';
        const isValidExit = this.validateExecutionPrice(
                isBuyPosition ? candle.low : candle.high, // Expected reference price
                exitPrice,
                !isBuyPosition // Inverse because selling a buy = sell order
            );

        if (!isValidExit) {
            console.error('Invalid exit price detected:', {
                positionType: this.currentPosition.type,
                expectedPrice: isBuyPosition ? candle.low : candle.high,
                actualExit: exitPrice,
                time: new Date(candle.time).toLocaleString()
            });
            return; // Or adjust price to valid range
        }

        // Validate exit time is after entry time
        if (new Date(candle.time) <= new Date(this.currentPosition.entryTime)) {
            console.warn('Invalid trade exit - exit time before entry time');
            return;
        }

        // Calculate PnL based on actual execution prices
        const pnlPercent = this.currentPosition.type === 'buy'
             ? ((exitPrice - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100
             : ((this.currentPosition.entryPrice - exitPrice) / this.currentPosition.entryPrice) * 100;

        const pnlAmount = this.currentPosition.type === 'buy'
             ? this.currentPosition.positionSize * (exitPrice - this.currentPosition.entryPrice)
             : this.currentPosition.positionSize * (this.currentPosition.entryPrice - exitPrice);

        const exitCommission = this.currentPosition.positionSize * exitPrice * this.tradeSettings.commission;

        // Update virtual balance
        this.tradeSettings.virtualBalance +=
        (this.currentPosition.positionSize * exitPrice) - exitCommission;

        const trade = {
            type: this.currentPosition.type,
            entryPrice: this.currentPosition.entryPrice, // Use actual execution price
            exitPrice: exitPrice,
            pnlPercent: pnlPercent,
            pnlAmount: pnlAmount,
            positionSize: this.currentPosition.positionSize,
            entryTime: this.currentPosition.entryTime,
            entryCandleIndex: this.currentPosition.entryCandleIndex,
            exitTime: candle.time,
            exitReason: exitReason,
            commissions: this.currentPosition.commissionPaid + exitCommission
        };

        this.trades.push(trade);
        this.currentPosition = null;
        this.showTradeNotification(trade, false); // Add this line

        // Update UI
        this.updateTradeList();
        this.updatePerformanceMetrics();

        // Add exit marker
        const markerType = exitReason === 'take profit' ? 'take-profit' :
            exitReason === 'stop loss' ? 'stop-loss' : 'sell';
        const labelText = `${exitReason.toUpperCase()} @ ${exitPrice.toFixed(2)} (${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%)`;

        this.addTradeMarker(candle.time, exitPrice, markerType, labelText);

        // Add trade line
        this.addTradeLine(this.currentPosition, candle, exitPrice);
        this.saveTradeData();
    }

    updatePerformanceMetrics() {
        if (this.trades.length === 0)
            return;

        let totalProfit = 0;
        let totalLoss = 0;
        let winningTrades = 0;
        let losingTrades = 0;
        let tradeDurations = [];
        let drawdown = 0;
        let maxDrawdown = 0;
        let equityHigh = this.tradeSettings.virtualBalance;

        this.trades.forEach(trade => {
            if (trade.pnlAmount >= 0) {
                winningTrades++;
                totalProfit += trade.pnlAmount;
            } else {
                losingTrades++;
                totalLoss += Math.abs(trade.pnlAmount);
            }

            const duration = (new Date(trade.exitTime) - new Date(trade.entryTime));
            tradeDurations.push(duration);

            // Calculate drawdown
            equityHigh = Math.max(equityHigh, this.tradeSettings.virtualBalance);
            drawdown = equityHigh - this.tradeSettings.virtualBalance;
            maxDrawdown = Math.max(maxDrawdown, drawdown);
        });

        this.performanceMetrics = {
            totalTrades: this.trades.length,
            winningTrades: winningTrades,
            losingTrades: losingTrades,
            winRate: (winningTrades / this.trades.length) * 100,
            totalPnl: totalProfit - totalLoss,
            maxDrawdown: maxDrawdown,
            profitFactor: totalLoss > 0 ? totalProfit / totalLoss : Infinity,
            averageTradeDuration: tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
        };

        this.updatePerformanceUI();
    }

    updatePerformanceUI() {
        document.getElementById('total-trades').textContent = this.performanceMetrics.totalTrades;
        document.getElementById('win-rate').textContent = this.performanceMetrics.winRate.toFixed(2) + '%';
        document.getElementById('profit-factor').textContent = this.performanceMetrics.profitFactor.toFixed(2);
        document.getElementById('total-pnl').textContent = this.performanceMetrics.totalPnl.toFixed(2);
        document.getElementById('max-drawdown').textContent = this.performanceMetrics.maxDrawdown.toFixed(2);
        document.getElementById('virtual-balance').textContent = this.tradeSettings.virtualBalance.toFixed(2);

        // Format with color based on profit/loss
        const totalPnlElement = document.getElementById('total-pnl');
        totalPnlElement.className = this.performanceMetrics.totalPnl >= 0 ? 'up' : 'down';
    }

    detectCandlestickPatterns(data) {
        for (let i = 2; i < data.length; i++) {
            const current = data[i];
            const previous = data[i - 1];
            const twoBefore = data[i - 2];

            // Reset pattern
            current.pattern = null;
            current.patternStrength = 0; // 0-2 scale (0=normal, 1=weak pattern, 2=strong pattern)

            // Calculate candle metrics
            const currentBody = Math.abs(current.close - current.open);
            const currentRange = current.high - current.low;
            const currentBodyRatio = currentRange > 0 ? currentBody / currentRange : 0;

            const prevBody = Math.abs(previous.close - previous.open);
            const prevRange = previous.high - previous.low;
            const prevBodyRatio = prevRange > 0 ? prevBody / prevRange : 0;

            // 1. Bullish Engulfing (Strong)
            if (current.close > current.open &&
                previous.close < previous.open &&
                current.open < previous.close &&
                current.close > previous.open) {
                current.pattern = 'bullish-engulfing';
                current.patternStrength = 2;
            }

            // 2. Bearish Engulfing (Strong)
            else if (current.close < current.open &&
                previous.close > previous.open &&
                current.open > previous.close &&
                current.close < previous.open) {
                current.pattern = 'bearish-engulfing';
                current.patternStrength = 2;
            }

            // 3. Hammer (Bullish)
            const lowerShadow = current.open > current.close ?
                current.close - current.low : current.open - current.low;
            const upperShadow = current.high - (current.open > current.close ?
                    current.open : current.close);

            if (lowerShadow >= 2 * currentBody &&
                upperShadow <= currentBody * 0.5 &&
                current.close > current.open &&
                currentBodyRatio > 0.1) { // Ensure there is a body
                current.pattern = 'hammer';
                current.patternStrength = 1;
            }

            // 4. Shooting Star (Bearish)
            else if (upperShadow >= 2 * currentBody &&
                lowerShadow <= currentBody * 0.5 &&
                current.close < current.open &&
                currentBodyRatio > 0.1) {
                current.pattern = 'shooting-star';
                current.patternStrength = 1;
            }

            // 5. Morning Star (Strong Bullish)
            if (twoBefore.close < twoBefore.open && // First candle is bearish
                Math.abs(previous.close - previous.open) < previous.range * 0.3 && // Small middle candle
                current.close > current.open && // Third candle is bullish
                current.close > twoBefore.open) { // Closes above first candle's open
                current.pattern = 'morning-star';
                current.patternStrength = 2;
            }

            // 6. Evening Star (Strong Bearish)
            else if (twoBefore.close > twoBefore.open && // First candle is bullish
                Math.abs(previous.close - previous.open) < previous.range * 0.3 && // Small middle candle
                current.close < current.open && // Third candle is bearish
                current.close < twoBefore.open) { // Closes below first candle's open
                current.pattern = 'evening-star';
                current.patternStrength = 2;
            }

            // 7. Piercing Line (Bullish)
            else if (previous.close < previous.open && // Previous was bearish
                current.close > current.open && // Current is bullish
                current.open < previous.low && // Opens below previous low
                current.close > (previous.open + previous.close) / 2) { // Closes above midpoint
                current.pattern = 'piercing-line';
                current.patternStrength = 1;
            }

            // 8. Dark Cloud Cover (Bearish)
            else if (previous.close > previous.open && // Previous was bullish
                current.close < current.open && // Current is bearish
                current.open > previous.high && // Opens above previous high
                current.close < (previous.open + previous.close) / 2) { // Closes below midpoint
                current.pattern = 'dark-cloud';
                current.patternStrength = 1;
            }

            // 9. Three White Soldiers (Strong Bullish)
            if (i >= 3 &&
                data[i - 2].close > data[i - 2].open &&
                previous.close > previous.open &&
                current.close > current.open &&
                current.close > previous.close &&
                previous.close > data[i - 2].close &&
                current.open > previous.open &&
                previous.open > data[i - 2].open) {
                current.pattern = 'three-white-soldiers';
                current.patternStrength = 2;
            }

            // 10. Three Black Crows (Strong Bearish)
            else if (i >= 3 &&
                data[i - 2].close < data[i - 2].open &&
                previous.close < previous.open &&
                current.close < current.open &&
                current.close < previous.close &&
                previous.close < data[i - 2].close &&
                current.open < previous.open &&
                previous.open < data[i - 2].open) {
                current.pattern = 'three-black-crows';
                current.patternStrength = 2;
            }

            // 11. Doji (Neutral/Reversal)
            else if (currentBodyRatio < 0.1 && // Very small body
                currentRange > 0 && // Has some range
                (lowerShadow > currentRange * 0.4 ||
                    upperShadow > currentRange * 0.4)) { // Significant shadow
                current.pattern = 'doji';
                current.patternStrength = 1;

                // Dragonfly Doji (Bullish)
                if (lowerShadow >= currentRange * 0.9) {
                    current.pattern = 'dragonfly-doji';
                    current.patternStrength = 1;
                }
                // Gravestone Doji (Bearish)
                else if (upperShadow >= currentRange * 0.9) {
                    current.pattern = 'gravestone-doji';
                    current.patternStrength = 1;
                }
            }

            // 12. Tweezer Top/Bottom (Reversal)
            if (previous.high === current.high &&
                previous.close < previous.open &&
                current.close > current.open) {
                current.pattern = 'tweezer-bottom';
                current.patternStrength = 1;
            } else if (previous.low === current.low &&
                previous.close > previous.open &&
                current.close < current.open) {
                current.pattern = 'tweezer-top';
                current.patternStrength = 1;
            }

            // 13. Inverted Hammer (Bullish)
            if (upperShadow >= 2 * currentBody &&
                lowerShadow <= currentBody * 0.5 &&
                current.close > current.open) {
                current.pattern = 'inverted-hammer';
                current.patternStrength = 1;
            }

            // 14. Hanging Man (Bearish)
            else if (lowerShadow >= 2 * currentBody &&
                upperShadow <= currentBody * 0.5 &&
                current.close < current.open) {
                current.pattern = 'hanging-man';
                current.patternStrength = 1;
            }
        }
    }

    checkPositionExitConditions(candle, candleIndex) {
        if (!this.currentPosition)
            return;

        // Only check exit conditions if we have a full candle (not the current forming candle)
        if (candleIndex === this.data.length - 1)
            return;

        if (this.currentPosition.type === 'buy') {
            // Check stop loss for long position (only if candle closes below SL)
            if (candle.close <= this.currentPosition.stopLoss) {
                const exitPrice = this.applySlippage(
                        Math.min(this.currentPosition.stopLoss, candle.close),
                        false);
                this.closePosition(candle, candleIndex, exitPrice, 'stop loss');
            }
            // Check take profit for long position (only if candle closes above TP)
            else if (candle.close >= this.currentPosition.takeProfit) {
                const exitPrice = this.applySlippage(
                        Math.max(this.currentPosition.takeProfit, candle.close),
                        false);
                this.closePosition(candle, candleIndex, exitPrice, 'take profit');
            }
        } else if (this.currentPosition.type === 'sell') {
            // Check stop loss for short position (only if candle closes above SL)
            if (candle.close >= this.currentPosition.stopLoss) {
                const exitPrice = this.applySlippage(
                        Math.max(this.currentPosition.stopLoss, candle.close),
                        true);
                this.closePosition(candle, candleIndex, exitPrice, 'stop loss');
            }
            // Check take profit for short position (only if candle closes below TP)
            else if (candle.close <= this.currentPosition.takeProfit) {
                const exitPrice = this.applySlippage(
                        Math.min(this.currentPosition.takeProfit, candle.close),
                        true);
                this.closePosition(candle, candleIndex, exitPrice, 'take profit');
            }
        }
    }

    addTradeMarker(time, price, type, labelText) {
        // Define all possible marker types and their colors
        const colors = {
            'buy': {
                bg: '#00c176',
                text: '#fff'
            },
            'sell': {
                bg: '#ff3b30',
                text: '#fff'
            },
            'take-profit': {
                bg: '#4caf50',
                text: '#fff'
            },
            'stop-loss': {
                bg: '#f44336',
                text: '#fff'
            },
            'buy-add': { // Add this for buy additions
                bg: '#00c176',
                text: '#fff'
            },
            'sell-add': { // Add this for sell additions
                bg: '#ff3b30',
                text: '#fff'
            }
        };

        // Default to buy style if type is unknown
        const markerStyle = colors[type] || colors['buy'];

        this.tradeMarkers.push({
            x: new Date(time),
            y: price,
            marker: {
                size: type === 'buy' || type === 'buy-add' ? 10 : 8,
                fillColor: markerStyle.bg,
                strokeColor: '#fff',
                radius: type === 'buy' || type === 'buy-add' ? 6 : 4,
                shape: type.includes('buy') ? 'triangle' : 'invertedTriangle',
                cssClass: `apexcharts-trade-marker apexcharts-trade-marker-${type}`
            },
            label: {
                text: labelText,
                style: {
                    color: markerStyle.text,
                    background: markerStyle.bg,
                    fontSize: '12px',
                    cssClass: 'apexcharts-trade-label'
                },
                offsetY: type.includes('buy') ? -20 : 20
            }
        });
    }

    addTradeLine(position, exitCandle, exitPrice) {
        try {
            // Check if position and required properties exist
            if (!position || !exitCandle || typeof position.entryCandleIndex === 'undefined') {
                console.warn('Invalid position or exit candle data - cannot add trade line');
                return;
            }

            const entryCandle = this.data[position.entryCandleIndex];

            // Additional safety check
            if (!entryCandle) {
                console.warn('Entry candle not found in data array');
                return;
            }

            const pnlPercent = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
            const isProfit = pnlPercent >= 0;

            // Calculate line coordinates with visual offsets to avoid marker overlap
            const entryX = new Date(entryCandle.time);
            const exitX = new Date(exitCandle.time);

            // Adjust y-position slightly to make lines more visible on candles
            const entryY = position.entryPrice * (isProfit ? 0.998 : 1.002);
            const exitY = exitPrice * (isProfit ? 1.002 : 0.998);

            // Dynamic line width based on position size (relative to max position size)
            const maxPositionSize = this.trades.length > 0
                 ? Math.max(...this.trades.map(t => t.positionSize), position.positionSize)
                 : position.positionSize;

            const lineWidth = 1 + (3 * (position.positionSize / maxPositionSize));

            // Calculate optimal label position
            const labelPosition = (exitX - entryX) / (1000 * 60 * 60) > 2 ? 'center' : 'right';

            this.tradeLines.push({
                x: entryX,
                y: entryY,
                x2: exitX,
                y2: exitY,
                strokeDashArray: 0,
                borderColor: isProfit ? '#00c176' : '#ff3b30',
                strokeWidth: lineWidth,
                opacity: 0.8,
                label: {
                    text: `${isProfit ? '+' : ''}${pnlPercent.toFixed(2)}%`,
                    borderColor: isProfit ? '#00c176' : '#ff3b30',
                    offsetY: isProfit ? -10 : 10,
                    style: {
                        color: '#fff',
                        background: isProfit ? '#00c176' : '#ff3b30',
                        fontSize: '12px',
                        padding: {
                            left: 6,
                            right: 6,
                            top: 2,
                            bottom: 2
                        },
                        borderRadius: '4px'
                    },
                    position: labelPosition,
                    textAnchor: 'middle'
                }
            });

            // Add small markers at line ends for better visibility
            this.tradeMarkers.push({
                x: entryX,
                y: entryY,
                marker: {
                    size: 4,
                    fillColor: isProfit ? '#00c176' : '#ff3b30',
                    strokeColor: '#fff',
                    radius: 2
                }
            });

            this.tradeMarkers.push({
                x: exitX,
                y: exitY,
                marker: {
                    size: 4,
                    fillColor: isProfit ? '#00c176' : '#ff3b30',
                    strokeColor: '#fff',
                    radius: 2
                }
            });
        } catch (error) {
            console.error('Error adding trade line:', error);
        }
    }

    // Add this new method
    updateTradeList() {
        const tradeListBody = document.getElementById('trade-list-body');

        // Clear existing trades
        tradeListBody.innerHTML = '';

        // Sort trades by entry time (oldest first)
        const sortedTrades = [...this.trades].sort((a, b) =>
            new Date(a.entryTime) - new Date(b.entryTime));

        // Add completed trades (now sorted)
        sortedTrades.forEach((trade, index) => {
            const row = document.createElement('tr');
            const pnlClass = trade.pnlAmount >= 0 ? 'trade-profit' : 'trade-loss';
            const exitReason = trade.exitReason === 'signal' ? '' : ` (${trade.exitReason})`;
            const durationMinutes = (new Date(trade.exitTime) - new Date(trade.entryTime)) / 1000 / 60;

            row.innerHTML = `
            <td>${index + 1}</td>
            <td>${trade.type.toUpperCase()}</td>
            <td>${trade.entryPrice.toFixed(2)}<br>
                <small>${new Date(trade.entryTime).toLocaleString()}</small></td>
            <td>${trade.exitPrice.toFixed(2)}${exitReason}<br>
                <small>${new Date(trade.exitTime).toLocaleString()}</small></td>
            <td>${trade.positionSize.toFixed(6)}</td>
            <td class="${pnlClass}">${trade.pnlAmount >= 0 ? '+' : ''}${trade.pnlAmount.toFixed(2)}</td>
            <td class="${pnlClass}">${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%</td>
            <td>${Math.floor(durationMinutes)} mins</td>
        `;

            tradeListBody.appendChild(row);
        });

        // Add current running trade if exists
        //console.log(this.currentPosition);
        if (this.currentPosition) {
            const row = document.createElement('tr');
            row.classList.add('running-trade');
            const durationMinutes = (new Date() - new Date(this.currentPosition.entryTime)) / 1000 / 60;
            if (this.data[this.data.length - 1]) {
                const currentPrice = this.data[this.data.length - 1].close;

                // Calculate PnL based on position type
                let pnlPercent,
                pnlAmount;
                if (this.currentPosition.type === 'buy') {
                    pnlPercent = ((currentPrice - this.currentPosition.entryPrice) / this.currentPosition.entryPrice) * 100;
                    pnlAmount = this.currentPosition.positionSize * (currentPrice - this.currentPosition.entryPrice) * this.tradeSettings.dollerPrice;
                } else {
                    pnlPercent = ((this.currentPosition.entryPrice - currentPrice) / this.currentPosition.entryPrice) * 100;
                    pnlAmount = this.currentPosition.positionSize * (this.currentPosition.entryPrice - currentPrice) * this.tradeSettings.dollerPrice;
                }

                row.innerHTML = `
                <td>${sortedTrades.length + 1}</td>
                <td>${this.currentPosition.type.toUpperCase()}</td>
                <td>${this.currentPosition.entryPrice.toFixed(2)}<br>
                    <small>${new Date(this.currentPosition.entryTime).toLocaleString()}</small></td>
                <td><em>Running...</em><br>
                    <small>Current: ${currentPrice.toFixed(2)}</small></td>
                <td>${this.currentPosition.positionSize.toFixed(6)}</td>
                <td class="${pnlAmount >= 0 ? 'trade-profit' : 'trade-loss'}">${pnlAmount >= 0 ? '+' : ''}${pnlAmount.toFixed(2)}</td>
                <td class="${pnlPercent >= 0 ? 'trade-profit' : 'trade-loss'}">${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(2)}%</td>
                <td>${Math.floor(durationMinutes)} mins</td>
            `;

                tradeListBody.appendChild(row);
            }
        }

        this.previousPair = this.pair;
    }
    // Add these methods to the CandleChart class

    getTradeHistoryPath() {
        return localStorage.getItem('tradeHistoryPath') || './trade_history/';
    }

    getTradeHistoryFilename() {
        return `${this.getTradeHistoryPath()}trade_history_${this.pair}.csv`;
    }

    parseLastTradeBalance(csvContent) {
        const lines = csvContent.trim().split('\n');
        if (lines.length < 2)
            return this.tradeSettings.virtualBalance;

        const lastLine = lines[lines.length - 1];
        const values = lastLine.split(',');
        return parseFloat(values[values.length - 1]) || this.tradeSettings.virtualBalance;
    }

    recreateTradeVisuals() {
        this.tradeMarkers = [];
        this.tradeLines = [];

        this.trades.forEach(trade => {
            // Find corresponding candles in current data
            const entryCandle = this.data.find(c =>
                    new Date(c.time).getTime() === new Date(trade.entryTime).getTime());
            const exitCandle = this.data.find(c =>
                    new Date(c.time).getTime() === new Date(trade.exitTime).getTime());

            if (entryCandle) {
                // Add entry marker
                this.addTradeMarker(
                    trade.entryTime,
                    trade.entryPrice,
                    trade.type,
`${trade.type.toUpperCase()} @ ${trade.entryPrice.toFixed(2)}`);

                if (exitCandle) {
                    // Add exit marker
                    const exitType = trade.exitReason === 'take profit' ? 'take-profit' :
                        trade.exitReason === 'stop loss' ? 'stop-loss' : 'sell';
                    this.addTradeMarker(
                        trade.exitTime,
                        trade.exitPrice,
                        exitType,
`${trade.exitReason.toUpperCase()} @ ${trade.exitPrice.toFixed(2)} (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)`);

                    // Add trade line
                    this.addTradeLine({
                        entryPrice: trade.entryPrice,
                        entryTime: trade.entryTime,
                        entryCandleIndex: this.data.indexOf(entryCandle),
                        positionSize: trade.positionSize
                    }, exitCandle, trade.exitPrice);
                }
            }
        });

        this.updateTradeList();
        this.updatePerformanceMetrics();
        this.updateChart();
    }
    initChart() {
        const chartOptions = {
            series: [],
            chart: {
                type: 'candlestick',
                height: 400,
                toolbar: {
                    show: true
                },
                zoom: {
                    enabled: true
                },
                animations: {
                    enabled: true
                },
                fontFamily: 'inherit'
            },
            plotOptions: {
                candlestick: {
                    colors: {
                        upward: '#00c176',
                        downward: '#ff3b30'
                    },
                    wick: {
                        useFillColor: true
                    }
                }
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        return this.formatTimeForTimeframe(new Date(value));
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            yaxis: [{
                    seriesName: this.pair,
                    tooltip: {
                        enabled: true
                    },
                    opposite: true,
                    labels: {
                        formatter: function (value) {
                            return parseFloat(value).toFixed(2);
                        },
                        style: {
                            colors: '#e0e3eb',
                            fontSize: '12px'
                        }
                    },
                    axisBorder: {
                        show: true,
                        color: '#2a3241'
                    },
                    axisTicks: {
                        show: true,
                        color: '#2a3241'
                    }
                }
            ],
            tooltip: {
                enabled: true,
                shared: true,
                intersect: false,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    // Get the candle data for the hovered point
                    const hoveredCandle = this.data[dataPointIndex];
                    if (hoveredCandle) {
                        this.updateInfoPanel(hoveredCandle);
                    }
                    return '';
                }
            },
            grid: {
                show: true,
                borderColor: '#2a3241',
                strokeDashArray: 0,
                position: 'back'
            },
            annotations: {
                points: []
            },
            stroke: {
                width: [2, 1, 1]
            }
        };

        this.chart = new ApexCharts(document.querySelector("#chart"), chartOptions);
        this.chart.render();
    }
    // Add this method to your CandleChart class
    showTradeNotification(trade, isEntry) {
        if (!this.notificationContainer)
            this.initNotifications();

        const isBuy = trade.type === 'buy';
        const action = isEntry ? 'Executed' : 'Completed';
        const title = `${isBuy ? 'BUY' : 'SELL'} ${action}`;
        const color = isBuy ? '#00c176' : '#ff3b30';
        const icon = isBuy ? '💰' : '💸';

        const pnlText = !isEntry && trade.pnlPercent
             ? ` (${trade.pnlPercent >= 0 ? '+' : ''}${trade.pnlPercent.toFixed(2)}%)`
             : '';

        const price = isEntry ? trade.entryPrice : trade.exitPrice;
        const time = new Date().toLocaleTimeString();

        const notification = document.createElement('div');
        notification.className = 'candle-notification';
        notification.style.backgroundColor = '#1E1E1E';
        notification.style.color = 'white';
        notification.style.padding = '15px';
        notification.style.borderRadius = '8px';
        notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        notification.style.borderLeft = `4px solid ${color}`;
        notification.style.transform = 'translateX(120%)';
        notification.style.transition = 'transform 0.3s ease-out';
        notification.style.position = 'relative';
        notification.style.overflow = 'hidden';

        notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 24px; color: ${color}">${icon}</div>
            <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: 600; font-size: 15px;">${title}</div>
                    <div style="font-weight: bold; font-size: 14px; color: ${color}">
                        ${isBuy ? 'BUY' : 'SELL'} ${pnlText}
                    </div>
                </div>
                <div style="font-size: 13px; opacity: 0.8; margin-bottom: 6px;">
                    ${isEntry ? 'New position opened' : 'Position closed'} ${!isEntry ? `($ {
                trade.exitReason
            })` : ''}
                </div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                    <div style="opacity: 0.7;">${this.pair} • ${price.toFixed(2)}</div>
                </div>
				<div style="display: flex; justify-content: space-between; font-size: 12px;">
				<div style="opacity: 0.6;">${time}</div>
				</div>
            </div>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${color}, transparent);"></div>
    `;

        this.notificationContainer.prepend(notification);

        // Trigger the slide-in animation
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto-remove after 15 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        }, 15000);

        // Add click to dismiss
        notification.addEventListener('click', () => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        });
    }
    // Add these methods to the CandleChart class
    downloadTradeHistory() {
        if (this.trades.length === 0) {
            alert('No trade history to download');
            return;
        }

        const headers = [
            'Type', 'EntryPrice', 'ExitPrice', 'PositionSize', 'P/LAmount',
            'P/LPercent', 'EntryTime', 'ExitTime', 'DurationMins',
            'ExitReason', 'Commissions', 'VirtualBalanceAfter'
        ];

        // Calculate running balance
        let runningBalance = this.tradeSettings.virtualBalance;
        const tradesWithBalance = [...this.trades]
        .sort((a, b) => new Date(a.entryTime) - new Date(b.entryTime))
        .map(trade => ({
                ...trade,
                virtualBalanceAfter: runningBalance
            }));

        // Create CSV content
        let csvContent = headers.join(',') + '\n';
        tradesWithBalance.forEach(trade => {
            const durationMinutes = (new Date(trade.exitTime) - new Date(trade.entryTime)) / (1000 * 60);
            const row = [
                trade.type.toUpperCase(),
                trade.entryPrice.toFixed(8),
                trade.exitPrice.toFixed(8),
                trade.positionSize.toFixed(8),
                trade.pnlAmount.toFixed(2),
                trade.pnlPercent.toFixed(2),
                new Date(trade.entryTime).toISOString(),
                new Date(trade.exitTime).toISOString(),
                durationMinutes.toFixed(0),
                trade.exitReason,
                trade.commissions.toFixed(2),
                trade.virtualBalanceAfter.toFixed(2)
            ].join(',');
            csvContent += row + '\n';
        });

        // Create download link
        const blob = new Blob([csvContent], {
            type: 'text/csv;charset=utf-8;'
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `trade_history_${this.pair}_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    handleTradeHistoryUpload(event) {
        const file = event.target.files[0];
        if (!file)
            return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const csvData = e.target.result;
                this.parseAndLoadTradeHistory(csvData);
            } catch (error) {
                console.error('Error parsing CSV file:', error);
                alert('Error parsing CSV file. Please check the format.');
            }
        };
        reader.readAsText(file);
    }

    parseAndLoadTradeHistory(csvData) {
        const lines = csvData.trim().split('\n');
        if (lines.length < 2) {
            alert('CSV file is empty or invalid');
            return;
        }

        const headers = lines[0].split(',');
        this.trades = [];

        // Find the indices of each column
        const typeIndex = headers.indexOf('Type');
        const entryPriceIndex = headers.indexOf('EntryPrice');
        const exitPriceIndex = headers.indexOf('ExitPrice');
        const positionSizeIndex = headers.indexOf('PositionSize');
        const pnlAmountIndex = headers.indexOf('P/LAmount');
        const pnlPercentIndex = headers.indexOf('P/LPercent');
        const entryTimeIndex = headers.indexOf('EntryTime');
        const exitTimeIndex = headers.indexOf('ExitTime');
        const exitReasonIndex = headers.indexOf('ExitReason');
        const commissionsIndex = headers.indexOf('Commissions');
        const balanceIndex = headers.indexOf('VirtualBalanceAfter');

        for (let i = 1; i < lines.length; i++) {
            if (!lines[i])
                continue;

            const values = lines[i].split(',');
            if (values.length < headers.length)
                continue;

            const trade = {
                type: values[typeIndex].toLowerCase(),
                entryPrice: parseFloat(values[entryPriceIndex]),
                exitPrice: parseFloat(values[exitPriceIndex]),
                positionSize: parseFloat(values[positionSizeIndex]),
                pnlAmount: parseFloat(values[pnlAmountIndex]),
                pnlPercent: parseFloat(values[pnlPercentIndex]),
                entryTime: values[entryTimeIndex],
                exitTime: values[exitTimeIndex],
                exitReason: values[exitReasonIndex] ? values[exitReasonIndex].toLowerCase() : 'signal',
                commissions: parseFloat(values[commissionsIndex] || 0)
            };

            this.trades.push(trade);
        }

        // Update virtual balance from last trade if available
        if (this.trades.length > 0 && balanceIndex !== -1) {
            const lastLine = lines[lines.length - 1];
            const lastValues = lastLine.split(',');
            if (lastValues[balanceIndex]) {
                this.tradeSettings.virtualBalance = parseFloat(lastValues[balanceIndex]);
            }
        }

        this.recreateTradeVisuals();
        alert(`Successfully loaded ${this.trades.length} trades from CSV`);
    }

    initEventListeners() {
        // Timeframe dropdown
        document.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Remove active class from all items
                document.querySelectorAll('.dropdown-item').forEach(i => {
                    i.classList.remove('active');
                });

                // Add active class to clicked item
                e.target.classList.add('active');

                // Update displayed timeframe
                document.getElementById('current-timeframe').textContent =
                    e.target.dataset.timeframe;

                // Set the timeframe and reload data
                this.timeframe = e.target.dataset.timeframe;
                this.loadData();
            });
        });

        // Market pair selector
        document.getElementById('marketPair').addEventListener('change', (e) => {
            this.saveTradeData();
            this.loadTradeData();
            // Reset trade history when pair changes
            if (this.pair !== e.target.value) {
                this.trades = [];
                this.currentPosition = null;
            }
            this.pair = e.target.value;
            this.loadData();
        });

        // Indicator controls
        document.getElementById('supertrend-toggle').addEventListener('change', (e) => {
            this.indicators.supertrend.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('supertrend-period').addEventListener('change', (e) => {
            this.indicators.supertrend.period = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('supertrend-multiplier').addEventListener('change', (e) => {
            this.indicators.supertrend.multiplier = parseFloat(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-toggle').addEventListener('change', (e) => {
            this.indicators.rsi.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('rsi-period').addEventListener('change', (e) => {
            this.indicators.rsi.period = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-overbought').addEventListener('change', (e) => {
            this.indicators.rsi.overbought = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('rsi-oversold').addEventListener('change', (e) => {
            this.indicators.rsi.oversold = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-toggle').addEventListener('change', (e) => {
            this.indicators.macd.enabled = e.target.checked;
            this.loadData();
        });

        document.getElementById('macd-fast').addEventListener('change', (e) => {
            this.indicators.macd.fastPeriod = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-slow').addEventListener('change', (e) => {
            this.indicators.macd.slowPeriod = parseInt(e.target.value);
            this.loadData();
        });

        document.getElementById('macd-signal').addEventListener('change', (e) => {
            this.indicators.macd.signalPeriod = parseInt(e.target.value);
            this.loadData();
        });
        // Add to initEventListeners method
        document.getElementById('download-trades-btn').addEventListener('click', () => {
            this.downloadTradeHistory();
        });

        document.getElementById('trade-history-upload').addEventListener('change', (e) => {
            this.handleTradeHistoryUpload(e);
            e.target.value = ''; // Reset input to allow re-uploading same file
        });

        document.getElementById('supertrend-toggle').addEventListener('change', (e) => {
            this.indicators.supertrend.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('rsi-toggle').addEventListener('change', (e) => {
            this.indicators.rsi.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('macd-toggle').addEventListener('change', (e) => {
            this.indicators.macd.enabled = e.target.checked;
            this.updateChart(); // Changed from loadData()
        });

        document.getElementById('chart').addEventListener('mouseleave', () => {
            this.updateInfoPanel(); // Reset to show latest candle values
        });
        // Add to initEventListeners():
        document.getElementById('clear-trades-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to clear all trade history for this pair?')) {
                localStorage.removeItem(`tradeData_${this.pair}`);
                this.trades = [];
                this.currentPosition = null;
                this.tradeSettings.virtualBalance = 100000;
                this.updatePerformanceMetrics();
                this.updateTradeList();
                this.updateChart();
            }
        });
    }

    startAutoRefresh() {
        if (this.refreshInterval)
            clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => this.loadData(), 10000);
    }

    async loadData(limit = 60) {
        try {
            const binanceTimeframe = this.binanceTimeframes[this.timeframe] || '15m';
            const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${this.pair}&interval=${binanceTimeframe}&limit=${limit}`);
            let binanceData = await response.json();

            if (!binanceData || binanceData.length === 0) {
                throw new Error('No data received from Binance API');
            }

            // Convert Binance format to our expected format
            const newData = binanceData.map(item => ({
                        time: item[0],
                        open: parseFloat(item[1]),
                        high: parseFloat(item[2]),
                        low: parseFloat(item[3]),
                        close: parseFloat(item[4]),
                        volume: parseFloat(item[5]),
                        vwap: 0, // Initialize VWAP
                        volumeMA: 0, // Initialize Volume MA
                        ema20: 0, // Initialize EMA20
                        ema50: 0 // Initialize EMA50
                    }));

            // Sort in ascending order (oldest first)
            newData.sort((a, b) => a.time - b.time);
            this.detectCandlestickPatterns(newData);
            // Check if we have a new candle with a pattern
            if (this.data.length > 0 && newData.length > 0) {
                const lastOldCandle = this.data[this.data.length - 1];
                const newCandle = newData.find(c => c.time > lastOldCandle.time);

                if (newCandle && newCandle.pattern) {
                    this.showNotification(newCandle.pattern, newCandle);
                }
            }
            // Calculate indicators
            this.calculateSupertrend(newData);
            this.calculateRSI(newData);
            this.calculateMACD(newData);
            this.calculateVWAP(newData); // NEW: VWAP
            this.calculateVolumeMA(newData, 20); // NEW: Volume MA (20-period)
            this.calculateSupportResistance(newData);
            // Calculate EMAs
            for (let i = 0; i < newData.length; i++) {
                newData[i].ema20 = this.calculateEMA(newData, 20, i);
                newData[i].ema50 = this.calculateEMA(newData, 50, i);
            }
            this.detectSignals(newData);
            this.simulateTrades(newData);
            this.data = newData;
            this.updateChart();
            this.updateInfoPanel();
            this.updateCurrentPrice();
        } catch (error) {
            console.error('Error loading candle data:', error);
            if (!this.refreshInterval) {
                alert(`Error loading data: ${error.message}`);
            }
        }
    }

    calculateVWAP(data) {
        let cumulativePV = 0; // Price × Volume
        let cumulativeVolume = 0;

        for (let i = 0; i < data.length; i++) {
            const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
            cumulativePV += typicalPrice * data[i].volume;
            cumulativeVolume += data[i].volume;
            data[i].vwap = cumulativeVolume > 0 ? (cumulativePV / cumulativeVolume) : 0;
        }
    }

    calculateVolumeMA(data, period = 20) {
        for (let i = period - 1; i < data.length; i++) {
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j].volume;
            }
            data[i].volumeMA = sum / period;
        }
    }

    calculateEMA(data, period, index) {
        if (index < period - 1)
            return null;

        // First EMA = SMA (Simple Moving Average)
        if (index === period - 1) {
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += data[index - i].close;
            }
            return sum / period;
        }

        // Subsequent EMAs use smoothing
        const multiplier = 2 / (period + 1);
        const prevEMA = data[index - 1][`ema${period}`] || this.calculateEMA(data, period, index - 1);
        return (data[index].close - prevEMA) * multiplier + prevEMA;
    }

    calculateSupertrend(data) {
        if (!this.indicators.supertrend.enabled)
            return;

        const period = this.indicators.supertrend.period;
        const multiplier = this.indicators.supertrend.multiplier;

        // Calculate ATR first
        for (let i = 1; i < data.length; i++) {
            const tr = Math.max(
                    data[i].high - data[i].low,
                    Math.abs(data[i].high - data[i - 1].close),
                    Math.abs(data[i].low - data[i - 1].close));
            data[i].tr = tr;
        }

        // Calculate ATR as SMA of TR
        for (let i = period; i < data.length; i++) {
            let sumTR = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sumTR += data[j].tr;
            }
            data[i].atr = sumTR / period;
        }

        // Calculate Supertrend with additional confirmation indicators
        for (let i = period; i < data.length; i++) {
            const hl2 = (data[i].high + data[i].low) / 2;
            const basicUpper = hl2 + multiplier * data[i].atr;
            const basicLower = hl2 - multiplier * data[i].atr;

            if (i === period) {
                // First Supertrend value
                data[i].supertrendUpper = basicUpper;
                data[i].supertrendLower = basicLower;
                data[i].supertrendDirection = data[i].close > basicUpper ? 'up' : 'down';
            } else {
                // Final upper band
                data[i].supertrendUpper = data[i - 1].supertrendDirection === 'up'
                     ? Math.max(basicUpper, data[i - 1].supertrendUpper)
                     : basicUpper;

                // Final lower band
                data[i].supertrendLower = data[i - 1].supertrendDirection === 'down'
                     ? Math.min(basicLower, data[i - 1].supertrendLower)
                     : basicLower;

                // Enhanced trend direction determination with multiple confirmations
                const bullishConditions = [
                    data[i].close > data[i].supertrendUpper,
                    this.indicators.rsi.enabled ? data[i].rsi > this.indicators.rsi.oversold : true,
                    this.indicators.macd.enabled ? data[i].macd > data[i].signalValue : true,
                    data[i].close > data[i].vwap,
                    data[i].close > data[i].ema20,
                    data[i].volume > data[i].volumeMA * 1.2
                ].filter(Boolean).length;

                const bearishConditions = [
                    data[i].close < data[i].supertrendLower,
                    this.indicators.rsi.enabled ? data[i].rsi < this.indicators.rsi.overbought : true,
                    this.indicators.macd.enabled ? data[i].macd < data[i].signalValue : true,
                    data[i].close < data[i].vwap,
                    data[i].close < data[i].ema20,
                    data[i].volume > data[i].volumeMA * 1.2
                ].filter(Boolean).length;

                // Require at least 3 confirmations for trend change
                if (bullishConditions >= 3) {
                    data[i].supertrendDirection = 'up';
                    data[i].supertrendStrength = bullishConditions;
                } else if (bearishConditions >= 3) {
                    data[i].supertrendDirection = 'down';
                    data[i].supertrendStrength = bearishConditions;
                } else {
                    data[i].supertrendDirection = data[i - 1].supertrendDirection;
                    data[i].supertrendStrength = 0;
                }
            }
        }
    }

    calculateRSI(data) {
        if (!this.indicators.rsi.enabled)
            return;

        const period = this.indicators.rsi.period;

        // First calculate gains and losses
        for (let i = 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            data[i].gain = Math.max(change, 0);
            data[i].loss = Math.abs(Math.min(change, 0));
        }

        // Calculate first average gains and losses
        let avgGain = 0;
        let avgLoss = 0;

        for (let i = 1; i <= period; i++) {
            avgGain += data[i].gain;
            avgLoss += data[i].loss;
        }

        avgGain /= period;
        avgLoss /= period;

        data[period].avgGain = avgGain;
        data[period].avgLoss = avgLoss;
        data[period].rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

        // Calculate subsequent RSI values
        for (let i = period + 1; i < data.length; i++) {
            data[i].avgGain = ((period - 1) * data[i - 1].avgGain + data[i].gain) / period;
            data[i].avgLoss = ((period - 1) * data[i - 1].avgLoss + data[i].loss) / period;

            const rs = data[i].avgLoss === 0 ? Infinity : data[i].avgGain / data[i].avgLoss;
            data[i].rsi = 100 - (100 / (1 + rs));
        }
    }

    calculateMACD(data) {
        if (!this.indicators.macd.enabled)
            return;

        const fastPeriod = this.indicators.macd.fastPeriod;
        const slowPeriod = this.indicators.macd.slowPeriod;
        const signalPeriod = this.indicators.macd.signalPeriod;

        // Initialize EMAs
        let emaFast = 0;
        let emaSlow = 0;
        let emaSignal = 0;
        let macdValues = []; // Array to store MACD values for signal calculation

        for (let i = 0; i < data.length; i++) {
            // Calculate initial SMA for fast EMA
            if (i === fastPeriod - 1) {
                let sum = 0;
                for (let j = 0; j < fastPeriod; j++) {
                    sum += data[i - j].close;
                }
                emaFast = sum / fastPeriod;
                data[i].emaFast = emaFast;
            }
            // Calculate fast EMA for subsequent periods
            else if (i >= fastPeriod) {
                const multiplier = 2 / (fastPeriod + 1);
                emaFast = (data[i].close - emaFast) * multiplier + emaFast;
                data[i].emaFast = emaFast;
            }

            // Calculate initial SMA for slow EMA
            if (i === slowPeriod - 1) {
                let sum = 0;
                for (let j = 0; j < slowPeriod; j++) {
                    sum += data[i - j].close;
                }
                emaSlow = sum / slowPeriod;
                data[i].emaSlow = emaSlow;
            }
            // Calculate slow EMA for subsequent periods
            else if (i >= slowPeriod) {
                const multiplier = 2 / (slowPeriod + 1);
                emaSlow = (data[i].close - emaSlow) * multiplier + emaSlow;
                data[i].emaSlow = emaSlow;
            }

            // Calculate MACD line (fast EMA - slow EMA)
            if (i >= slowPeriod) {
                data[i].macd = emaFast - emaSlow;
                macdValues.push(data[i].macd); // Store for signal calculation

                // Calculate signal line (EMA of MACD)
                if (i === slowPeriod + signalPeriod - 1) {
                    // First signal value is SMA of MACD values
                    let sum = 0;
                    for (let j = 0; j < signalPeriod; j++) {
                        sum += macdValues[j];
                    }
                    emaSignal = sum / signalPeriod;
                    data[i].signalValue = emaSignal;
                } else if (i > slowPeriod + signalPeriod - 1) {
                    // Subsequent signal values are EMA of MACD
                    const signalMultiplier = 2 / (signalPeriod + 1);
                    emaSignal = (data[i].macd - emaSignal) * signalMultiplier + emaSignal;
                    data[i].signalValue = emaSignal;
                }

                // Calculate histogram (MACD - Signal)
                if (i >= slowPeriod + signalPeriod - 1) {
                    data[i].histogram = data[i].macd - data[i].signalValue;
                }
            }
        }
    }

    calculateSupportResistance(data) {
        if (!this.indicators.supportResistance.enabled)
            return;

        const period = this.indicators.supportResistance.period;

        for (let i = period; i < data.length; i++) {
            // Find support (lowest low in period)
            let support = data[i].low;
            for (let j = i - period + 1; j <= i; j++) {
                if (data[j].low < support) {
                    support = data[j].low;
                }
            }

            // Find resistance (highest high in period)
            let resistance = data[i].high;
            for (let j = i - period + 1; j <= i; j++) {
                if (data[j].high > resistance) {
                    resistance = data[j].high;
                }
            }

            data[i].support = support;
            data[i].resistance = resistance;
        }
    }

    detectSignals(data) {
        const rsiPeriod = this.indicators.rsi.period;
        const macdPeriod = Math.max(
                this.indicators.macd.fastPeriod,
                this.indicators.macd.slowPeriod,
                this.indicators.macd.signalPeriod);
        const supertrendPeriod = this.indicators.supertrend.period;
        const minPeriod = Math.max(rsiPeriod, macdPeriod, supertrendPeriod);

        for (let i = minPeriod; i < data.length; i++) {
            data[i].signal = {
                type: null,
                price: null,
                value: null,
                signalValue: null,
                source: null
            };

            if (i < minPeriod + 5)
                continue; // Skip early candles

            // 1️⃣ Supertrend Direction
            const isSupertrendBullish = data[i].supertrendDirection === 'up';
            const isSupertrendBearish = data[i].supertrendDirection === 'down';

            // 2️⃣ RSI Condition
            const isRSIBullish = (data[i].rsi < this.indicators.rsi.oversold);
            const isRSIBearish = (data[i].rsi > this.indicators.rsi.overbought);

            // 3️⃣ MACD Crossover
            const isMACDBullish = (data[i].macd > data[i].signalValue);
            const isMACDBearish = (data[i].macd < data[i].signalValue);

            // 4️⃣ Volume Spike (50% above average)
            const isVolumeSpiking = (data[i].volume > data[i].volumeMA * 1.5);

            // 5️⃣ VWAP Position
            const isAboveVWAP = (data[i].close > data[i].vwap);
            const isBelowVWAP = (data[i].close < data[i].vwap);

            // 6️⃣ EMA Crossover (20 > 50 = Bullish)
            const isEMABullish = (data[i].ema20 > data[i].ema50);
            const isEMABearish = (data[i].ema20 < data[i].ema50);

            // ✅ STRONG BULLISH (All indicators agree)
            if (isSupertrendBullish && isRSIBullish && isMACDBullish && isVolumeSpiking && isAboveVWAP && isEMABullish) {
                data[i].signal.type = 'strong-buy';
                data[i].signal.source = 'multi-confirmation';
            }
            // ✅ STRONG BEARISH (All indicators agree)
            else if (isSupertrendBearish && isRSIBearish && isMACDBearish && isVolumeSpiking && isBelowVWAP && isEMABearish) {
                data[i].signal.type = 'strong-sell';
                data[i].signal.source = 'multi-confirmation';
            }
            // ⚠️ WEAK BULLISH (Partial confirmation)
            else if (isSupertrendBullish && isMACDBullish && isAboveVWAP) {
                data[i].signal.type = 'weak-buy';
                data[i].signal.source = 'partial-confirmation';
            }
            // ⚠️ WEAK BEARISH (Partial confirmation)
            else if (isSupertrendBearish && isMACDBearish && isBelowVWAP) {
                data[i].signal.type = 'weak-sell';
                data[i].signal.source = 'partial-confirmation';
            }

            // Set entry price (high for buys, low for sells)
            if (data[i].signal.type) {
                data[i].signal.price = data[i].signal.type.includes('buy') ? data[i].high : data[i].low;
            }
        }

        const signals = data.filter(d => d.signal && d.signal.type);
        /*console.log('Detected signals:', signals
        .map(s => ({
        time: new Date(s.time).toLocaleString(),
        type: s.signal.type,
        source: s.signal.source,
        signalPrice: s.close,
        executionPrice: s.signal.price
        }))
        .sort((a, b) => new Date(a.time) - new Date(b.time)));
         */
    }

    updateChart() {
        if (!this.data || this.data.length === 0)
            return;

        // Main candlestick series with pattern colors
        const patternColors = {
            // Bullish patterns
            'bullish-engulfing': '#00ff00',
            'hammer': '#90EE90',
            'morning-star': '#00ff00',
            'piercing-line': '#90EE90',
            'three-white-soldiers': '#00ff00',
            'dragonfly-doji': '#ADFF2F',
            'tweezer-bottom': '#90EE90',
            'inverted-hammer': '#90EE90',

            // Bearish patterns
            'bearish-engulfing': '#ff0000',
            'shooting-star': '#FFA07A',
            'evening-star': '#ff0000',
            'dark-cloud': '#FFA07A',
            'three-black-crows': '#ff0000',
            'gravestone-doji': '#FF6347',
            'tweezer-top': '#FFA07A',
            'hanging-man': '#FFA07A',

            // Neutral
            'doji': '#FFFF00'
        };

        // Main candlestick series with pattern colors
        const candlestickSeries = {
            name: this.pair,
            data: this.data.map(d => {
                // Default colors
                let fillColor = d.close >= d.open ? '#00c176' : '#ff3b30';
                let strokeColor = d.close >= d.open ? '#00c176' : '#ff3b30';

                // Apply pattern colors if exists
                if (d.pattern && patternColors[d.pattern]) {
                    fillColor = patternColors[d.pattern];
                    strokeColor = patternColors[d.pattern];

                    // For strong patterns, add a border effect
                    if (d.patternStrength === 2) {
                        strokeColor = '#FFFFFF';
                    }
                }

                return {
                    x: new Date(d.time),
                    y: [d.open, d.high, d.low, d.close],
                    fillColor: fillColor,
                    strokeColor: strokeColor
                };
            })
        };

        // Build series array based on enabled indicators
        const series = [candlestickSeries];

        // Only add Supertrend if enabled
        if (this.indicators.supertrend.enabled) {
            const supertrendUpperSeries = {
                name: 'Supertrend Upper',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.supertrendUpper || null
                    })),
                type: 'line',
                color: '#00c176',
                strokeWidth: 1.5
            };

            const supertrendLowerSeries = {
                name: 'Supertrend Lower',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.supertrendLower || null
                    })),
                type: 'line',
                color: '#ff3b30',
                strokeWidth: 1.5
            };

            series.push(supertrendUpperSeries);
            series.push(supertrendLowerSeries);
        }

        // Only add Support/Resistance if enabled
        if (this.indicators.supportResistance.enabled) {
            const supportSeries = {
                name: 'Support',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.support || null
                    })),
                type: 'line',
                color: '#4caf50',
                strokeDashArray: 5,
                strokeWidth: 1
            };

            const resistanceSeries = {
                name: 'Resistance',
                data: this.data.map(d => ({
                        x: new Date(d.time),
                        y: d.resistance || null
                    })),
                type: 'line',
                color: '#ff5722',
                strokeDashArray: 5,
                strokeWidth: 1
            };

            series.push(supportSeries);
            series.push(resistanceSeries);
        }

        // Signal markers - only show if indicators are enabled
        const signalMarkers = this.data
            .filter(d => d.signal && d.signal.type &&
                ((this.indicators.supertrend.enabled && d.signal.type.includes('supertrend')) ||
                    (this.indicators.rsi.enabled && d.signal.type.includes('rsi')) ||
                    (this.indicators.macd.enabled && d.signal.type.includes('macd'))))
            .map(d => {
                const isBuy = d.signal.type.includes('buy');
                return {
                    x: new Date(d.time),
                    y: isBuy ? d.low * 0.98 : d.high * 1.02,
                    marker: {
                        size: 10,
                        fillColor: isBuy ? '#00c176' : '#ff3b30',
                        strokeColor: '#fff',
                        strokeWidth: 2,
                        radius: 5,
                        shape: isBuy ? 'triangle' : 'invertedTriangle',
                        cssClass: 'apexcharts-candlestick-signal'
                    },
                    label: {
                        text: d.signal.type.toUpperCase(),
                        style: {
                            color: '#fff',
                            background: isBuy ? '#00c176' : '#ff3b30',
                            fontSize: '12px',
                            padding: {
                                left: 8,
                                right: 8,
                                top: 4,
                                bottom: 4
                            }
                        },
                        offsetY: isBuy ? -25 : 25
                    }
                };
            });

        // Update chart with all series and annotations
        this.chart.updateOptions({
            series: series,
            annotations: {
                points: [
                    ...signalMarkers,
                    ...(this.tradeMarkers || [])
                ],
                lines: this.tradeLines || []
            }
        }, false, true, true);

        // Update RSI and MACD charts if enabled
        if (this.indicators.rsi.enabled) {
            this.updateRSIChart();
        } else if (this.rsiChart) {
            this.rsiChart.destroy();
            this.rsiChart = null;
        }

        if (this.indicators.macd.enabled) {
            this.updateMACDChart();
        } else if (this.macdChart) {
            this.macdChart.destroy();
            this.macdChart = null;
        }
    }

    updateRSIChart() {
        const rsiSeries = {
            name: 'RSI',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.rsi || null
                })),
            type: 'line'
        };

        const rsiOptions = {
            series: [rsiSeries],
            chart: {
                height: 150,
                type: 'line',
                toolbar: {
                    show: false
                },
                animations: {
                    enabled: false
                },
                fontFamily: 'inherit'
            },
            stroke: {
                width: 2,
                colors: ['#3a7bd5']
            },
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        const date = new Date(value);
                        return this.formatTimeForTimeframe(date);
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            yaxis: {
                min: 0,
                max: 100,
                tickAmount: 5,
                labels: {
                    formatter: function (val) {
                        return Math.round(val);
                    },
                    style: {
                        colors: '#3a7bd5',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#3a7bd5'
                },
                axisTicks: {
                    show: true,
                    color: '#3a7bd5'
                }
            },
            grid: {
                borderColor: '#2a3241'
            },
            annotations: {
                yaxis: [{
                        y: this.indicators.rsi.overbought,
                        borderColor: '#ff5722',
                        strokeDashArray: 0,
                        opacity: 0.5
                    }, {
                        y: this.indicators.rsi.oversold,
                        borderColor: '#4caf50',
                        strokeDashArray: 0,
                        opacity: 0.5
                    }
                ]
            },
            tooltip: {
                enabled: true,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    // Fix: Get date from series data instead of categoryLabels
                    const dataPoint = w.config.series[seriesIndex].data[dataPointIndex];
                    const date = new Date(dataPoint.x);
                    const dateStr = this.formatTimeForTimeframe(date);

                    const rsiValue = dataPoint.y;
                    let status = '';

                    if (rsiValue >= this.indicators.rsi.overbought) {
                        status = '<div style="color:#ff5722;margin-top:5px">Overbought</div>';
                    } else if (rsiValue <= this.indicators.rsi.oversold) {
                        status = '<div style="color:#4caf50;margin-top:5px">Oversold</div>';
                    }

                    return `
                    <div class="tooltip-container">
                        <div class="tooltip-date">${dateStr}</div>
                        <div class="tooltip-data">
                            <div><span class="tooltip-label">RSI:</span> 
                            <span class="tooltip-value">${rsiValue ? rsiValue.toFixed(2) : 'N/A'}</span></div>
                            ${status}
                        </div>
                    </div>
                `;
                }
            }
        };

        if (!this.rsiChart) {
            this.rsiChart = new ApexCharts(document.querySelector("#rsi-chart"), rsiOptions);
            this.rsiChart.render();
        } else {
            this.rsiChart.updateOptions(rsiOptions);
        }
    }

    updateMACDChart() {
        const macdSeries = {
            name: 'MACD',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.macd || null
                })),
            type: 'line'
        };

        const signalSeries = {
            name: 'Signal',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.signalValue || null
                })),
            type: 'line'
        };

        const histogramSeries = {
            name: 'Histogram',
            data: this.data.map(d => ({
                    x: new Date(d.time),
                    y: d.histogram || null,
                    fillColor: d.histogram >= 0 ? '#00c176' : '#ff3b30'
                })),
            type: 'column'
        };

        // Calculate min/max for Y-axis with whole numbers
        const maxVal = Math.ceil(Math.max(
                    ...this.data.map(d => Math.abs(d.macd || 0)),
                    ...this.data.map(d => Math.abs(d.signalValue || 0))));
        const roundedMax = maxVal === 0 ? 1 : Math.ceil(maxVal);
        const yMin = -roundedMax;
        const yMax = roundedMax;
        const tickAmount = 4; // Shows 0, ±some value, ±max value

        const macdOptions = {
            series: [macdSeries, signalSeries, histogramSeries],
            chart: {
                height: 150,
                type: 'line',
                toolbar: {
                    show: false
                },
                animations: {
                    enabled: false
                },
                fontFamily: 'inherit'
            },
            stroke: {
                width: [2, 2, 0],
                colors: ['#3a7bd5', '#ff9800']
            },
            fill: {
                type: 'solid',
                opacity: 1
            },
            colors: ['#3a7bd5', '#ff9800', '#00c176'],
            xaxis: {
                type: 'datetime',
                labels: {
                    formatter: (value) => {
                        const date = new Date(value);
                        return this.formatTimeForTimeframe(date);
                    },
                    style: {
                        colors: '#a1a9bb',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#2a3241'
                },
                axisTicks: {
                    show: true,
                    color: '#2a3241'
                }
            },
            yaxis: {
                min: yMin,
                max: yMax,
                tickAmount: tickAmount,
                labels: {
                    formatter: function (val) {
                        // Show only whole numbers
                        return Number.isInteger(val) ? val : '';
                    },
                    style: {
                        colors: '#ff9800',
                        fontSize: '12px'
                    }
                },
                axisBorder: {
                    show: true,
                    color: '#ff9800'
                },
                axisTicks: {
                    show: true,
                    color: '#ff9800'
                }
            },
            grid: {
                borderColor: '#2a3241'
            },
            tooltip: {
                enabled: true,
                custom: ({
                    series,
                    seriesIndex,
                    dataPointIndex,
                    w
                }) => {
                    const dataPoint = w.config.series[0].data[dataPointIndex];
                    const date = new Date(dataPoint.x);
                    const dateStr = this.formatTimeForTimeframe(date);

                    const macdValue = series[0][dataPointIndex]?.toFixed(2) || 'N/A';
                    const signalValue = series[1][dataPointIndex]?.toFixed(2) || 'N/A';
                    const histogramValue = series[2][dataPointIndex]?.toFixed(2) || 'N/A';
                    const histColor = series[2][dataPointIndex] >= 0 ? '#00c176' : '#ff3b30';

                    return `
                    <div class="tooltip-container">
                        <div class="tooltip-date">${dateStr}</div>
                        <div class="tooltip-data">
                            <div><span class="tooltip-label">MACD:</span> 
                            <span class="tooltip-value">${macdValue}</span></div>
                            <div><span class="tooltip-label">Signal:</span> 
                            <span class="tooltip-value">${signalValue}</span></div>
                            <div><span class="tooltip-label">Histogram:</span> 
                            <span class="tooltip-value" style="color:${histColor}">${histogramValue}</span></div>
                        </div>
                    </div>
                `;
                }
            }
        };

        if (!this.macdChart) {
            this.macdChart = new ApexCharts(document.querySelector("#macd-chart"), macdOptions);
            this.macdChart.render();
        } else {
            this.macdChart.updateOptions(macdOptions);
        }
    }

    updateInfoPanel(candle) {
        // If no candle provided, use the latest candle
        const displayCandle = candle || this.data[this.data.length - 1];
        if (!displayCandle)
            return;

        const isUp = displayCandle.close > displayCandle.open;

        document.getElementById('info-open').textContent = displayCandle.open.toFixed(2);
        document.getElementById('info-high').textContent = displayCandle.high.toFixed(2);
        document.getElementById('info-low').textContent = displayCandle.low.toFixed(2);
        document.getElementById('info-close').textContent = displayCandle.close.toFixed(2);
        document.getElementById('info-volume').textContent = displayCandle.volume.toFixed(2);
        // NEW: VWAP, Volume MA, EMAs
        //document.getElementById('info-vwap').textContent = displayCandle.vwap?.toFixed(2) || 'N/A';
        //document.getElementById('info-volume-ma').textContent = displayCandle.volumeMA?.toFixed(2) || 'N/A';
        //document.getElementById('info-ema20').textContent = displayCandle.ema20?.toFixed(2) || 'N/A';
        //document.getElementById('info-ema50').textContent = displayCandle.ema50?.toFixed(2) || 'N/A';

        // Update indicator values
        if (this.indicators.supertrend.enabled) {
            document.getElementById('info-supertrend').textContent =
                displayCandle.supertrendDirection === 'up' ? 'Bullish' : 'Bearish';
            document.getElementById('info-supertrend').className =
                displayCandle.supertrendDirection === 'up' ? 'up' : 'down';
        }

        if (this.indicators.rsi.enabled) {
            document.getElementById('info-rsi').textContent = displayCandle.rsi ? displayCandle.rsi.toFixed(2) : 'N/A';
            document.getElementById('info-rsi').className =
                displayCandle.rsi > this.indicators.rsi.overbought ? 'overbought' :
                displayCandle.rsi < this.indicators.rsi.oversold ? 'oversold' : '';
        }

        if (this.indicators.macd.enabled) {
            document.getElementById('info-macd').textContent = displayCandle.macd ? displayCandle.macd.toFixed(2) : 'N/A';
            document.getElementById('info-signal').textContent = displayCandle.signalValue ? displayCandle.signalValue.toFixed(2) : 'N/A';
            document.getElementById('info-histogram').textContent = displayCandle.histogram ? displayCandle.histogram.toFixed(2) : 'N/A';

            // Set color for histogram
            const histogramElement = document.getElementById('info-histogram');
            histogramElement.className = '';
            if (displayCandle.histogram) {
                histogramElement.className = displayCandle.histogram >= 0 ? 'up' : 'down';
            }
        }

        if (this.indicators.supportResistance.enabled) {
            document.getElementById('info-support').textContent = displayCandle.support ? displayCandle.support.toFixed(2) : 'N/A';
            document.getElementById('info-resistance').textContent = displayCandle.resistance ? displayCandle.resistance.toFixed(2) : 'N/A';
        }

        // Update colors based on price direction
        const colorClass = isUp ? 'up' : 'down';
        ['open', 'high', 'low', 'close'].forEach(id => {
            const element = document.getElementById(`info-${id}`);
            element.classList.remove('up', 'down');
            element.classList.add(colorClass);
        });
    }

    async updateCurrentPrice() {
        try {
            // Fetch 24h ticker data from Binance
            const response = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${this.pair}`);
            const tickerData = await response.json();

            const currentPrice = parseFloat(tickerData.lastPrice);
            const priceChange = parseFloat(tickerData.priceChangePercent);

            document.getElementById('current-pair').innerHTML = `
				${this.pair.replace('USDT', '/USDT')} 
				<span class="current-price">$${currentPrice.toFixed(2)}</span>
				<span class="price-change ${priceChange >= 0 ? 'up' : 'down'}">
					${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%
				</span>
			`;
        } catch (error) {
            console.error("Failed to fetch 24h price change:", error);
        }
    }

    formatTimeForTimeframe(date) {
        switch (this.timeframe) {
        case '1d':
            return date.toLocaleDateString(navigator.language, {
                month: 'short',
                day: 'numeric'
            });
        case '4h':
        case '1h':
            return date.toLocaleTimeString(navigator.language, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        default: // 1m, 5m, 15m
            return date.toLocaleTimeString(navigator.language, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
        }
    }

    // Notification system setup
    // Update these methods in your CandleChart class

    initNotifications() {
        // Remove existing container if it exists
        const existingContainer = document.getElementById('candle-notifications');
        if (existingContainer)
            existingContainer.remove();

        this.notificationContainer = document.createElement('div');
        this.notificationContainer.id = 'candle-notifications';
        this.notificationContainer.style.position = 'fixed';
        this.notificationContainer.style.top = '20px';
        this.notificationContainer.style.right = '20px';
        this.notificationContainer.style.zIndex = '10000'; // Higher z-index to ensure visibility
        this.notificationContainer.style.display = 'flex';
        this.notificationContainer.style.flexDirection = 'column';
        this.notificationContainer.style.gap = '10px';
        this.notificationContainer.style.maxWidth = '350px';
        document.body.appendChild(this.notificationContainer);
    }

    showNotification(pattern, candle) {
        if (!this.notificationContainer)
            this.initNotifications();

        const patternInfo = {
            'hammer': {
                title: 'Hammer Pattern Detected',
                message: 'Bullish reversal signal suggesting potential buying opportunity',
                color: '#4CAF50',
                icon: '🔨',
                action: 'Consider BUY'
            },
            'bullish-engulfing': {
                title: 'Bullish Engulfing',
                message: 'Strong bullish reversal pattern after a downtrend',
                color: '#2E7D32',
                icon: '📈',
                action: 'Strong BUY Signal'
            },
            'morning-star': {
                title: 'Morning Star',
                message: 'Reliable bullish reversal pattern after a downtrend',
                color: '#1B5E20',
                icon: '🌅',
                action: 'Strong BUY'
            },
            'shooting-star': {
                title: 'Shooting Star',
                message: 'Bearish reversal signal at the top of an uptrend',
                color: '#D32F2F',
                icon: '💫',
                action: 'Consider SELL'
            },
            'bearish-engulfing': {
                title: 'Bearish Engulfing',
                message: 'Strong bearish reversal pattern after an uptrend',
                color: '#B71C1C',
                icon: '📉',
                action: 'Strong SELL Signal'
            },
            'evening-star': {
                title: 'Evening Star',
                message: 'Reliable bearish reversal pattern after an uptrend',
                color: '#7F0000',
                icon: '🌇',
                action: 'Strong SELL'
            },
            'inverted-hammer': {
                title: 'Inverted Hammer',
                message: 'Bullish reversal signal after a downtrend',
                color: '#689F38',
                icon: '🔝',
                action: 'Potential BUY'
            },
            'hanging-man': {
                title: 'Hanging Man',
                message: 'Bearish reversal signal at the top of an uptrend',
                color: '#E53935',
                icon: '🪂',
                action: 'Potential SELL'
            }
        };

        const info = patternInfo[pattern] || {
            title: `${pattern} Pattern`,
            message: 'Significant candlestick pattern detected',
            color: '#FFC107',
            icon: '👀',
            action: 'Watch Closely'
        };

        const price = candle.close.toFixed(2);
        const time = new Date(candle.time).toLocaleTimeString();

        const notification = document.createElement('div');
        notification.className = 'candle-notification';
        notification.style.backgroundColor = '#1E1E1E';
        notification.style.color = 'white';
        notification.style.padding = '15px';
        notification.style.borderRadius = '8px';
        notification.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
        notification.style.borderLeft = `4px solid ${info.color}`;
        notification.style.transform = 'translateX(120%)';
        notification.style.transition = 'transform 0.3s ease-out';
        notification.style.position = 'relative';
        notification.style.overflow = 'hidden';

        notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 24px; color: ${info.color}">${info.icon}</div>
            <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <div style="font-weight: 600; font-size: 15px;">${info.title}</div>
                    <div style="font-weight: bold; font-size: 14px; color: ${info.color}">${info.action}</div>
                </div>
                <div style="font-size: 13px; opacity: 0.8; margin-bottom: 6px;">${info.message}</div>
                <div style="display: flex; justify-content: space-between; font-size: 12px;">
                    <div style="opacity: 0.7;">${this.pair} • ${price}</div>
                    <div style="opacity: 0.6;">${time}</div>
                </div>
            </div>
        </div>
        <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, ${info.color}, transparent);"></div>
    `;

        this.notificationContainer.prepend(notification);

        // Trigger the slide-in animation
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);

        // Auto-remove after 8 seconds
        setTimeout(() => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        }, 15000);

        // Add click to dismiss
        notification.addEventListener('click', () => {
            notification.style.transform = 'translateX(120%)';
            setTimeout(() => notification.remove(), 300);
        });
    }

    // Update the CSS styles
    addNotificationStyles() {
        const style = document.createElement('style');
        style.textContent = `
        .candle-notification {
            cursor: pointer;
            transition: transform 0.3s ease-out, opacity 0.2s ease;
        }
        .candle-notification:hover {
            transform: translateX(0) scale(1.02) !important;
            box-shadow: 0 6px 16px rgba(0,0,0,0.4);
        }
    `;
        document.head.appendChild(style);
    }
}

// Initialize chart when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CandleChart();
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', function () {
            // Remove active class from all buttons and content
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            // Add active class to clicked button and corresponding content
            this.classList.add('active');
            const tabId = this.getAttribute('data-tab');
            document.getElementById(tabId).classList.add('active');
        });
    });

    const settingsBtn = document.getElementById('settings-btn');
    const popupClose = document.getElementById('popup-close');
    const settingsPopup = document.getElementById('settings-popup');
    const overlay = document.getElementById('settings-overlay');

    settingsBtn.addEventListener('click', function () {
        settingsPopup.classList.add('active');
        overlay.classList.add('active');
    });

    popupClose.addEventListener('click', function () {
        settingsPopup.classList.remove('active');
        overlay.classList.remove('active');
    });

    overlay.addEventListener('click', function () {
        settingsPopup.classList.remove('active');
        overlay.classList.remove('active');
    });

});
