🚀 Project Charter: Riga Business Navigator
AI-Driven Location Intelligence for Small Business Entrepreneurs

1. Vision & Value Proposition
The Problem: Small entrepreneurs in Riga often choose business locations based on "gut feeling" rather than data, leading to high failure rates in competitive areas or missed opportunities in underserved ones.
The Solution: A web-based tool that uses Data Science (Clustering & Regression) to analyze business density, competitor performance, and "points of attraction" to suggest the optimal location for a new venture (e.g., a specialty coffee shop).

2. General Architecture
Проект строится по принципу End-to-End Pipeline: от сырых данных до интерактивного интерфейса.

Code snippet
graph LR
    A[Data Sources] --> B[Data Engine]
    B --> C[DS Core]
    C --> D[Web Application]
    D --> E[End User]
A. Data Engine (Сбор и обработка)

Scrapers: Скрипты на Python для сбора данных из Google Maps API / Places API или открытых каталогов (1188.lv).

Open Data Integration: Загрузка GeoJSON границ районов Риги с data.riga.lv.

Database: Хранение обработанных данных в структурированном виде (SQLite или PostgreSQL).

B. DS Core (Аналитика)

Feature Engineering: Создание признаков (кол-во конкурентов в радиусе, средний рейтинг района, близость к вузам).

Unsupervised Learning (K-Means): Сегментация районов по бизнес-типажам.

Supervised Learning (Regression): Анализ факторов, коррелирующих с высоким рейтингом заведений (Score Prediction).

C. Web Application (Интерфейс)

Backend: API на Flask/FastAPI, которое отдает результаты моделей.

Frontend: Интерактивная карта (React/Vue + Leaflet).

3. Detailed Tech Stack
Layer	Technology	Why?
Language	Python 3.10+	Стандарт для DS и отличные веб-фреймворки.
Data Scraping	BeautifulSoup / Selenium	Для извлечения данных из веб-каталогов.
Data Processing	Pandas, GeoPandas	Работа с таблицами и географическими координатами.
Machine Learning	Scikit-learn	Реализация кластеризации и регрессии.
Backend API	FastAPI	Быстрый, современный, легко документируемый.
Frontend	React.js	Создание динамичного и профессионального интерфейса.
Maps	Leaflet.js / React-Leaflet	Легкая и мощная библиотека для отрисовки карт.
4. Implementation Roadmap (Step-by-Step)
Phase 1: Data Acquisition (2-3 weeks)

[ ] Написать парсер для сбора данных о кафе в Риге (Название, Координаты, Рейтинг, Кол-во отзывов).

[ ] Найти и скачать GeoJSON файл с границами микрорайонов Риги.

[ ] Собрать координаты "точек притяжения" (университеты, крупные ТЦ, офисные кластеры).

Phase 2: DS Analysis & Modeling (2-3 weeks)

[ ] Preprocessing: Очистка данных, привязка каждой точки к конкретному району (Spatial Join).

[ ] Clustering: Запустить K-Means, чтобы сгруппировать районы (например: "Студенческие", "Люксовый центр", "Промышленные/Спальные").

[ ] Regression: Проверить гипотезу: влияет ли близость к университету на средний рейтинг кофейни выше, чем количество отзывов?

Phase 3: Web Development (2-3 weeks)

[ ] Разработать Backend API, который по запросу GET /districts отдает статистику и тип кластера.

[ ] Создать Frontend с картой Риги.

[ ] Реализовать визуализацию: окрашивание районов в зависимости от уровня конкуренции (Choropleth map).

Phase 4: Optimization & Deployment (1 week)

[ ] Финальная шлифовка UI/UX.

[ ] Деплой на бесплатный хостинг (например, Render или Vercel).